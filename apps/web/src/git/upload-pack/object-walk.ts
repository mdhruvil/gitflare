/**
 * Object traversal for upload-pack.
 *
 * Provides two paths:
 * 1. Fresh clone: Query all objects directly (no graph walking)
 * 2. Incremental fetch: Walk from wants to haves using commit_graph cache
 *
 * Uses recursive CTEs for efficient ancestor traversal in SQLite.
 */

import { Result, TaggedError } from "better-result";
import { inArray, sql } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { ObjectStore } from "@/do/object-store";
import type * as schema from "@/do/schema/git";
import { commitGraph, gitObjectIndex } from "@/do/schema/git";
import type { GitObjectType } from "@/git/object";

type DB = DrizzleSqliteDODatabase<typeof schema>;

export type ObjectMetadata = {
  oid: string;
  type: GitObjectType;
  packId: string;
  packOffset: number;
  compressedSize: number;
};

export type WalkResult = {
  objects: ObjectMetadata[];
  commits: number;
  trees: number;
  blobs: number;
  tags: number;
};

export type WalkErrorCode =
  | "INVALID_WANT"
  | "DB_ERROR"
  | "OBJECT_NOT_FOUND"
  | "TRAVERSAL_ERROR";

export class WalkError extends TaggedError("WalkError")<{
  code: WalkErrorCode;
  message: string;
}>() {}

type TreeEntry = {
  mode: string;
  name: string;
  oid: string;
};

/**
 * Get all objects for a fresh clone.
 * No graph walking needed - just query all objects from SQLite.
 *
 * Objects are ordered by pack_id, pack_offset for optimal sequential R2 reads.
 */
export async function getAllObjectsForClone(
  db: DB
): Promise<Result<WalkResult, WalkError>> {
  return Result.tryPromise({
    try: async () => {
      const rows = db
        .select({
          oid: gitObjectIndex.oid,
          type: gitObjectIndex.type,
          packId: gitObjectIndex.packId,
          packOffset: gitObjectIndex.packOffset,
          compressedSize: gitObjectIndex.compressedSize,
        })
        .from(gitObjectIndex)
        .orderBy(gitObjectIndex.packId, gitObjectIndex.packOffset)
        .all();

      const objects: ObjectMetadata[] = [];
      let commits = 0;
      let trees = 0;
      let blobs = 0;
      let tags = 0;

      for (const row of rows) {
        objects.push({
          oid: row.oid,
          type: row.type,
          packId: row.packId,
          packOffset: row.packOffset,
          compressedSize: row.compressedSize,
        });

        switch (row.type) {
          case "commit":
            commits += 1;
            break;
          case "tree":
            trees += 1;
            break;
          case "blob":
            blobs += 1;
            break;
          case "tag":
            tags += 1;
            break;
          default:
            break;
        }
      }

      return { objects, commits, trees, blobs, tags };
    },
    catch: (cause) =>
      new WalkError({
        code: "DB_ERROR",
        message: `Failed to query objects: ${String(cause)}`,
      }),
  });
}

export type WalkOptions = {
  db: DB;
  objectStore: ObjectStore;
  onProgress?: (count: number) => void;
};

/**
 * Walk objects for an incremental fetch.
 * Uses commit_graph cache to avoid R2 reads for commits.
 *
 * Algorithm:
 * 1. Get ancestor closure from haves (single recursive CTE)
 * 2. Walk from wants, stopping at complete set (single recursive CTE)
 * 3. Expand trees to discover blobs (batched R2 reads)
 * 4. Return all objects with packfile metadata
 */
export async function walkObjectsIncremental(
  wants: string[],
  haves: string[],
  options: WalkOptions
): Promise<Result<WalkResult, WalkError>> {
  const { db, objectStore, onProgress } = options;

  return Result.gen(async function* () {
    // Step 1: Mark all ancestors of haves as complete
    const complete =
      haves.length > 0
        ? yield* Result.await(getAncestorClosure(db, haves))
        : new Set<string>();

    onProgress?.(complete.size);

    // Step 2: Walk from wants, collecting commits and their trees
    const walkResult = yield* Result.await(walkFromWants(db, wants, complete));

    onProgress?.(complete.size + walkResult.commits.length);

    // Step 3: Expand trees to get all tree and blob OIDs
    const treeBlobs = yield* Result.await(
      expandTrees(objectStore, walkResult.trees, onProgress)
    );

    // Step 4: Get metadata for all objects
    const allOids = new Set<string>([
      ...walkResult.commits,
      ...treeBlobs.trees,
      ...treeBlobs.blobs,
    ]);

    const objects = yield* Result.await(getObjectsMetadata(db, [...allOids]));

    return Result.ok({
      objects,
      commits: walkResult.commits.length,
      trees: treeBlobs.trees.length,
      blobs: treeBlobs.blobs.length,
      tags: 0,
    });
  });
}

/**
 * Get all ancestors of the given OIDs using a recursive CTE.
 * This marks the "complete" set for incremental fetches.
 *
 * Note: Uses raw SQL because Drizzle doesn't support recursive CTEs with json_each.
 */
async function getAncestorClosure(
  db: DB,
  roots: string[]
): Promise<Result<Set<string>, WalkError>> {
  if (roots.length === 0) {
    return Result.ok(new Set());
  }

  return Result.tryPromise({
    try: async () => {
      // First verify which roots exist in commit_graph
      const existingRoots = db
        .select({ oid: commitGraph.oid })
        .from(commitGraph)
        .where(inArray(commitGraph.oid, roots))
        .all();

      if (existingRoots.length === 0) {
        return new Set<string>();
      }

      // Build IN clause with proper escaping for recursive CTE
      const quotedRoots = existingRoots.map((r) => `'${r.oid}'`).join(", ");

      const rows = db.all<{ oid: string }>(
        sql.raw(`
          WITH RECURSIVE ancestors(oid) AS (
            SELECT oid FROM commit_graph WHERE oid IN (${quotedRoots})
            UNION
            SELECT j.value
            FROM ancestors a
            JOIN commit_graph cg ON cg.oid = a.oid
            JOIN json_each(cg.parent_oids) j
          )
          SELECT oid FROM ancestors
        `)
      );

      return new Set(rows.map((r) => r.oid));
    },
    catch: (cause) =>
      new WalkError({
        code: "DB_ERROR",
        message: `Failed to get ancestor closure: ${String(cause)}`,
      }),
  });
}

type WalkFromWantsResult = {
  commits: string[];
  trees: string[];
};

/**
 * Walk from wants, stopping when hitting the complete set.
 * Returns commit OIDs and their associated tree OIDs.
 *
 * Note: Uses raw SQL because Drizzle doesn't support recursive CTEs with json_each.
 */
async function walkFromWants(
  db: DB,
  wants: string[],
  complete: Set<string>
): Promise<Result<WalkFromWantsResult, WalkError>> {
  if (wants.length === 0) {
    return Result.ok({ commits: [], trees: [] });
  }

  return Result.tryPromise({
    try: async () => {
      // First verify which wants exist in commit_graph
      const existingWants = db
        .select({ oid: commitGraph.oid })
        .from(commitGraph)
        .where(inArray(commitGraph.oid, wants))
        .all();

      if (existingWants.length === 0) {
        return { commits: [], trees: [] };
      }

      // Build IN clause with proper escaping for recursive CTE
      const quotedWants = existingWants.map((w) => `'${w.oid}'`).join(", ");

      const rows = db.all<{ oid: string; tree_oid: string }>(
        sql.raw(`
          WITH RECURSIVE walk(oid, tree_oid) AS (
            SELECT oid, tree_oid FROM commit_graph WHERE oid IN (${quotedWants})
            UNION
            SELECT cg.oid, cg.tree_oid
            FROM walk w
            JOIN json_each((SELECT parent_oids FROM commit_graph WHERE oid = w.oid)) j
            JOIN commit_graph cg ON cg.oid = j.value
          )
          SELECT DISTINCT oid, tree_oid FROM walk
        `)
      );

      const commits: string[] = [];
      const trees: string[] = [];
      const seenTrees = new Set<string>();

      for (const row of rows) {
        if (!complete.has(row.oid)) {
          commits.push(row.oid);

          if (!seenTrees.has(row.tree_oid)) {
            seenTrees.add(row.tree_oid);
            trees.push(row.tree_oid);
          }
        }
      }

      return { commits, trees };
    },
    catch: (cause) =>
      new WalkError({
        code: "DB_ERROR",
        message: `Failed to walk from wants: ${String(cause)}`,
      }),
  });
}

type ExpandTreesResult = {
  trees: string[];
  blobs: string[];
};

/**
 * Expand trees to discover all tree and blob OIDs.
 * Requires R2 reads to parse tree content (batched by packfile).
 */
async function expandTrees(
  objectStore: ObjectStore,
  rootTrees: string[],
  onProgress?: (count: number) => void
): Promise<Result<ExpandTreesResult, WalkError>> {
  if (rootTrees.length === 0) {
    return Result.ok({ trees: [], blobs: [] });
  }

  const allTrees = new Set<string>(rootTrees);
  const allBlobs = new Set<string>();
  const pending = [...rootTrees];
  let processed = 0;

  while (pending.length > 0) {
    const batch = pending.splice(0, 100);

    for (const treeOid of batch) {
      const objectResult = await objectStore.read(treeOid);
      if (objectResult.isErr()) {
        return Result.err(
          new WalkError({
            code: "OBJECT_NOT_FOUND",
            message: `Failed to read tree ${treeOid}: ${objectResult.error.message}`,
          })
        );
      }

      const entries = parseTreeEntries(objectResult.value.data);
      if (entries.isErr()) {
        return Result.err(
          new WalkError({
            code: "TRAVERSAL_ERROR",
            message: `Failed to parse tree ${treeOid}: ${entries.error.message}`,
          })
        );
      }

      for (const entry of entries.value) {
        if (entry.mode === "40000" || entry.mode === "040000") {
          if (!allTrees.has(entry.oid)) {
            allTrees.add(entry.oid);
            pending.push(entry.oid);
          }
        } else {
          allBlobs.add(entry.oid);
        }
      }

      processed += 1;
      onProgress?.(processed);
    }
  }

  return Result.ok({
    trees: [...allTrees],
    blobs: [...allBlobs],
  });
}

/**
 * Get object metadata for a list of OIDs.
 * Orders by pack_id, pack_offset for optimal R2 reads.
 */
async function getObjectsMetadata(
  db: DB,
  oids: string[]
): Promise<Result<ObjectMetadata[], WalkError>> {
  if (oids.length === 0) {
    return Result.ok([]);
  }

  return Result.tryPromise({
    try: async () => {
      const rows = db
        .select({
          oid: gitObjectIndex.oid,
          type: gitObjectIndex.type,
          packId: gitObjectIndex.packId,
          packOffset: gitObjectIndex.packOffset,
          compressedSize: gitObjectIndex.compressedSize,
        })
        .from(gitObjectIndex)
        .where(inArray(gitObjectIndex.oid, oids))
        .orderBy(gitObjectIndex.packId, gitObjectIndex.packOffset)
        .all();

      return rows.map((row) => ({
        oid: row.oid,
        type: row.type,
        packId: row.packId,
        packOffset: row.packOffset,
        compressedSize: row.compressedSize,
      }));
    },
    catch: (cause) =>
      new WalkError({
        code: "DB_ERROR",
        message: `Failed to get object metadata: ${String(cause)}`,
      }),
  });
}

/**
 * Parse tree entries from raw tree object data.
 *
 * Tree format:
 * ```
 * <mode> SP <name> NUL <20-byte-oid>
 * ```
 * Repeated for each entry.
 */
export function parseTreeEntries(
  data: Uint8Array
): Result<TreeEntry[], WalkError> {
  const entries: TreeEntry[] = [];
  let offset = 0;

  while (offset < data.length) {
    const spaceIdx = data.indexOf(0x20, offset);
    if (spaceIdx === -1) {
      return Result.err(
        new WalkError({
          code: "TRAVERSAL_ERROR",
          message: "Invalid tree entry: missing space",
        })
      );
    }

    const mode = new TextDecoder().decode(data.subarray(offset, spaceIdx));

    const nullIdx = data.indexOf(0x00, spaceIdx + 1);
    if (nullIdx === -1) {
      return Result.err(
        new WalkError({
          code: "TRAVERSAL_ERROR",
          message: "Invalid tree entry: missing null byte",
        })
      );
    }

    const name = new TextDecoder().decode(data.subarray(spaceIdx + 1, nullIdx));

    const oidStart = nullIdx + 1;
    const oidEnd = oidStart + 20;
    if (oidEnd > data.length) {
      return Result.err(
        new WalkError({
          code: "TRAVERSAL_ERROR",
          message: "Invalid tree entry: truncated OID",
        })
      );
    }

    const oidBytes = data.subarray(oidStart, oidEnd);
    const oid = Array.from(oidBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    entries.push({ mode, name, oid });
    offset = oidEnd;
  }

  return Result.ok(entries);
}

/**
 * Validate that all wanted OIDs exist as advertised refs.
 */
export function validateWants(
  wants: string[],
  advertisedOids: Set<string>
): Result<void, WalkError> {
  for (const want of wants) {
    if (!advertisedOids.has(want)) {
      return Result.err(
        new WalkError({
          code: "INVALID_WANT",
          message: `Object ${want} was not advertised`,
        })
      );
    }
  }

  return Result.ok(undefined);
}

/**
 * Filter OIDs to only those that exist in the object store.
 */
export async function filterExistingOids(
  objectStore: ObjectStore,
  oids: string[]
): Promise<string[]> {
  const existing: string[] = [];

  for (const oid of oids) {
    if (await objectStore.has(oid)) {
      existing.push(oid);
    }
  }

  return existing;
}
