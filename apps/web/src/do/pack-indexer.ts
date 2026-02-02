/**
 * Pack Indexer: Index packfiles and store metadata in SQLite.
 *
 * Handles:
 * - Parsing packfile stream via PackfileParser
 * - Computing OIDs for base objects
 * - Resolving REF_DELTA objects (in-memory + existing objects for thin packs)
 * - Batch inserting index entries into SQLite
 * - Populating commit_graph cache for efficient ancestry traversal
 * - Progress reporting for streaming responses
 */

import { Result, TaggedError } from "better-result";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { Delta } from "@/git/delta";
import { GitObject, type GitObjectType } from "@/git/object";
import { PackfileParser } from "@/git/pack";
import type { ObjectStore } from "./object-store";
import * as schema from "./schema/git";

type IndexedObject = {
  oid: string;
  type: GitObjectType;
  offset: number;
  compressedSize: number;
  isDelta: boolean;
  baseOid: string | undefined;
};

type CommitGraphEntry = {
  oid: string;
  treeOid: string;
  parentOids: string[];
};

type IndexResult = {
  packId: string;
  objectCount: number;
  deltaCount: number;
  objects: IndexedObject[];
};

export type ProgressEvent =
  | { type: "unpacking"; current: number; total: number }
  | { type: "resolving_deltas"; current: number; total: number }
  | { type: "writing_index"; count: number };

export type PackIndexErrorCode =
  | "PARSE_ERROR"
  | "DELTA_BASE_NOT_FOUND"
  | "DELTA_APPLY_ERROR"
  | "OFS_DELTA_NOT_SUPPORTED"
  | "DB_ERROR"
  | "CHECKSUM_MISMATCH";

export class PackIndexError extends TaggedError("PackIndexError")<{
  code: PackIndexErrorCode;
  message: string;
  offset?: number;
}>() {}

type ResolvedObjectData = {
  type: GitObjectType;
  data: Uint8Array;
};

type PendingDelta = {
  offset: number;
  compressedSize: number;
  baseHash: string;
  deltaData: Uint8Array;
};

type DB = DrizzleSqliteDODatabase<typeof schema>;

export type PackIndexerDeps = {
  db: DB;
  existingObjects: ObjectStore;
};

export class PackIndexer {
  private readonly db: DB;
  private readonly existingObjects: ObjectStore;

  constructor(deps: PackIndexerDeps) {
    this.db = deps.db;
    this.existingObjects = deps.existingObjects;
  }

  /**
   * Index a packfile stream.
   *
   * Algorithm:
   * 1. Parse all objects, resolving base objects immediately
   * 2. Iterate over pending deltas until all resolved (or error)
   * 3. Batch write to SQLite
   */
  async index(
    packId: string,
    r2Key: string,
    packStream: ReadableStream<Uint8Array>,
    onProgress?: (event: ProgressEvent) => void | Promise<void>
  ): Promise<Result<IndexResult, PackIndexError>> {
    const resolvedObjects = new Map<string, ResolvedObjectData>();
    const pendingDeltas: PendingDelta[] = [];
    const indexEntries: IndexedObject[] = [];
    const commitGraphEntries: CommitGraphEntry[] = [];

    let objectsTotal = 0;

    const parser = new PackfileParser(packStream);

    for await (const eventResult of parser.parse()) {
      if (eventResult.isErr()) {
        return Result.err(
          new PackIndexError({
            code: "PARSE_ERROR",
            message: eventResult.error.message,
            offset: eventResult.error.offset,
          })
        );
      }

      const event = eventResult.value;

      if (event.type === "header") {
        objectsTotal = event.objectCount;
        continue;
      }

      if (event.type === "result") {
        if (!event.valid) {
          return Result.err(
            new PackIndexError({
              code: "CHECKSUM_MISMATCH",
              message: "Packfile checksum verification failed",
            })
          );
        }
        continue;
      }

      const { objectType, data, offset } = event;

      // Compressed size = bytes consumed for this object
      // offset is where object started, bytesRead is where parser is now
      const compressedSize = parser.progress.bytesRead - offset;

      await onProgress?.({
        type: "unpacking",
        current: parser.progress.objectsParsed,
        total: objectsTotal,
      });

      if (objectType === "ofs_delta") {
        return Result.err(
          new PackIndexError({
            code: "OFS_DELTA_NOT_SUPPORTED",
            message: `OFS_DELTA not supported at offset ${offset}`,
            offset,
          })
        );
      }

      if (objectType === "ref_delta") {
        pendingDeltas.push({
          offset,
          compressedSize,
          baseHash: event.baseHash,
          deltaData: data,
        });
        continue;
      }

      const oid = GitObject.computeOid(objectType, data);
      resolvedObjects.set(oid, { type: objectType, data });
      indexEntries.push({
        oid,
        type: objectType,
        offset,
        compressedSize,
        isDelta: false,
        baseOid: undefined,
      });

      // Extract commit graph data for ancestry traversal cache
      if (objectType === "commit") {
        const commitResult = GitObject.parseCommitForWalk(data);
        if (commitResult.isOk()) {
          const { tree, parents } = commitResult.value;
          commitGraphEntries.push({ oid, treeOid: tree, parentOids: parents });
        }
      }
    }

    // Now we resolve deltas
    const totalDeltas = pendingDeltas.length;
    let resolvedCount = 0;

    while (pendingDeltas.length > 0) {
      let resolvedAny = false;

      for (let i = pendingDeltas.length - 1; i >= 0; i -= 1) {
        const delta = pendingDeltas[i];

        // Try to find base in resolved objects
        let base = resolvedObjects.get(delta.baseHash);

        // If not found, try existing storage (thin pack support)
        if (!base) {
          const existingResult = await this.existingObjects.read(
            delta.baseHash
          );
          if (existingResult.isOk()) {
            const existing = existingResult.value;
            base = { type: existing.type, data: existing.data };
            // Cache for other deltas that might reference it
            resolvedObjects.set(delta.baseHash, base);
          }
        }

        if (!base) {
          // Base not yet available, skip for now
          continue;
        }

        // Apply delta
        const applyResult = Delta.apply(base.data, delta.deltaData);
        if (applyResult.isErr()) {
          return Result.err(
            new PackIndexError({
              code: "DELTA_APPLY_ERROR",
              message: `Delta apply failed at offset ${delta.offset}: ${applyResult.error.message}`,
              offset: delta.offset,
            })
          );
        }

        const resolvedData = applyResult.value;
        const oid = GitObject.computeOid(base.type, resolvedData);

        resolvedObjects.set(oid, { type: base.type, data: resolvedData });
        indexEntries.push({
          oid,
          type: base.type,
          offset: delta.offset,
          compressedSize: delta.compressedSize,
          isDelta: true,
          baseOid: delta.baseHash,
        });

        // Extract commit graph data for delta-resolved commits
        if (base.type === "commit") {
          const commitResult = GitObject.parseCommitForWalk(resolvedData);
          if (commitResult.isOk()) {
            const { tree, parents } = commitResult.value;
            commitGraphEntries.push({
              oid,
              treeOid: tree,
              parentOids: parents,
            });
          }
        }

        // Remove from pending
        pendingDeltas.splice(i, 1);
        resolvedCount += 1;
        resolvedAny = true;

        await onProgress?.({
          type: "resolving_deltas",
          current: resolvedCount,
          total: totalDeltas,
        });
      }

      // If we made no progress and still have pending deltas, bases are missing
      if (!resolvedAny && pendingDeltas.length > 0) {
        const missingBases = [...new Set(pendingDeltas.map((d) => d.baseHash))];
        return Result.err(
          new PackIndexError({
            code: "DELTA_BASE_NOT_FOUND",
            message: `Missing delta base(s): ${missingBases.slice(0, 3).join(", ")}${missingBases.length > 3 ? ` and ${missingBases.length - 3} more` : ""}`,
          })
        );
      }
    }

    // Pass 3: Write to SQLite
    await onProgress?.({ type: "writing_index", count: indexEntries.length });

    const writeResult = await this.writeIndex(
      packId,
      r2Key,
      indexEntries,
      commitGraphEntries
    );
    if (writeResult.isErr()) {
      return writeResult;
    }

    return Result.ok({
      packId,
      objectCount: indexEntries.length,
      deltaCount: totalDeltas,
      objects: indexEntries,
    });
  }

  /**
   * Write pack, object index, and commit graph entries to SQLite in a single transaction.
   */
  private async writeIndex(
    packId: string,
    r2Key: string,
    entries: IndexedObject[],
    commitGraphEntries: CommitGraphEntry[]
  ): Promise<Result<void, PackIndexError>> {
    return Result.tryPromise({
      try: async () => {
        await this.db.transaction(async (tx) => {
          await tx.insert(schema.gitPacks).values({
            packId,
            r2Key,
            objectCount: entries.length,
          });

          // Batch insert object index entries
          // SQLite has a limit on variables per statement, so batch in chunks
          const BATCH_SIZE = 10;
          for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const batch = entries.slice(i, i + BATCH_SIZE);
            await tx.insert(schema.gitObjectIndex).values(
              batch.map((entry) => ({
                oid: entry.oid,
                packId,
                packOffset: entry.offset,
                compressedSize: entry.compressedSize,
                type: entry.type,
                isDelta: entry.isDelta,
                baseOid: entry.baseOid,
              }))
            );
          }

          // Insert commit graph entries for ancestry traversal cache
          for (let i = 0; i < commitGraphEntries.length; i += BATCH_SIZE) {
            const batch = commitGraphEntries.slice(i, i + BATCH_SIZE);
            await tx
              .insert(schema.commitGraph)
              .values(batch)
              .onConflictDoNothing();
          }
        });
      },
      catch: (cause) =>
        new PackIndexError({
          code: "DB_ERROR",
          message: `Database error: ${String(cause)}`,
        }),
    });
  }
}
