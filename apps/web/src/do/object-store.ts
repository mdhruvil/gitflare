/**
 * ObjectStore: Read git objects from storage.
 *
 * Handles:
 * - Looking up objects in git_object_index
 * - Fetching compressed data from R2
 * - Decompressing objects
 * - Delta resolution (using recursive CTE for efficient chain traversal)
 */

import { inflateSync } from "node:zlib";
import { Result, TaggedError } from "better-result";
import { eq, sql } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { Delta } from "@/git/delta";
import type { GitObjectType } from "@/git/object";
import type { R2 } from "./r2";
import * as schema from "./schema/git";

const MAX_DELTA_DEPTH = 50;

/**
 * Maximum gap between objects to coalesce into a single R2 range request.
 * If two objects in the same pack are within this gap, fetch them together.
 */
const COALESCE_GAP_THRESHOLD = 4096; // 4KB

export type ResolvedObject = {
  oid: string;
  type: GitObjectType;
  data: Uint8Array;
};

export type ObjectStoreErrorCode =
  | "NOT_FOUND"
  | "R2_ERROR"
  | "DECOMPRESS_ERROR"
  | "DELTA_ERROR"
  | "CYCLE_DETECTED"
  | "DELTA_DEPTH_EXCEEDED"
  | "DB_ERROR";

export class ObjectStoreError extends TaggedError("ObjectStoreError")<{
  code: ObjectStoreErrorCode;
  message: string;
  oid: string;
}>() {}

type DB = DrizzleSqliteDODatabase<typeof schema>;

/**
 * Row returned by the recursive CTE query for delta chain traversal.
 * Ordered from target object (depth=0) to base object (highest depth).
 */
type DeltaChainRow = {
  oid: string;
  pack_id: string;
  pack_offset: number;
  compressed_size: number;
  type: string;
  is_delta: number;
  base_oid: string | null;
  r2_key: string;
  depth: number;
};

/**
 * A coalesced range request that fetches multiple objects in one R2 call.
 */
type CoalescedRange = {
  r2Key: string;
  offset: number;
  length: number;
  /** Objects contained in this range, with their position relative to range start */
  objects: Array<{
    oid: string;
    relativeOffset: number;
    compressedSize: number;
  }>;
};

export class ObjectStore {
  private readonly db: DB;
  private readonly r2: R2;

  constructor(db: DB, r2: R2) {
    this.db = db;
    this.r2 = r2;
  }

  async has(oid: string) {
    const result = await this.db.query.gitObjectIndex.findFirst({
      where: eq(schema.gitObjectIndex.oid, oid),
      columns: { oid: true },
    });
    return result !== undefined;
  }

  /**
   * Fetch the entire delta chain for an OID using a recursive CTE.
   * Returns rows ordered from target (depth=0) to base (highest depth).
   *
   * The CTE:
   * 1. Starts with the requested OID at depth 0
   * 2. Recursively joins on base_oid to traverse the chain
   * 3. Stops when reaching a non-delta object or max depth
   * 4. Detects cycles via the depth limit (SQLite doesn't have native cycle detection)
   */
  private async fetchDeltaChain(
    oid: string
  ): Promise<Result<DeltaChainRow[], ObjectStoreError>> {
    const query = sql`
      WITH RECURSIVE delta_chain(oid, pack_id, pack_offset, compressed_size, type, is_delta, base_oid, r2_key, depth) AS (
        -- Base case: start with the requested OID
        SELECT 
          o.oid,
          o.pack_id,
          o.pack_offset,
          o.compressed_size,
          o.type,
          o.is_delta,
          o.base_oid,
          p.r2_key,
          0 as depth
        FROM git_object_index o
        JOIN git_packs p ON o.pack_id = p.pack_id
        WHERE o.oid = ${oid}
        
        UNION ALL
        
        -- Recursive case: follow base_oid links
        SELECT 
          o.oid,
          o.pack_id,
          o.pack_offset,
          o.compressed_size,
          o.type,
          o.is_delta,
          o.base_oid,
          p.r2_key,
          dc.depth + 1
        FROM delta_chain dc
        JOIN git_object_index o ON dc.base_oid = o.oid
        JOIN git_packs p ON o.pack_id = p.pack_id
        WHERE dc.is_delta = 1 
          AND dc.base_oid IS NOT NULL
          AND dc.depth < ${MAX_DELTA_DEPTH}
      )
      SELECT * FROM delta_chain ORDER BY depth ASC
    `;

    return Result.tryPromise({
      try: async () => {
        const result = this.db.all<DeltaChainRow>(query);
        return result;
      },
      catch: (cause) =>
        new ObjectStoreError({
          code: "DB_ERROR",
          message: `Database error: ${String(cause)}`,
          oid,
        }),
    });
  }

  /**
   * Build coalesced ranges from delta chain rows.
   *
   * Groups objects by R2 key, sorts by offset, and merges adjacent/nearby
   * objects into single range requests to minimize R2 subrequests.
   */
  private buildCoalescedRanges(chain: DeltaChainRow[]): CoalescedRange[] {
    // Group by r2_key
    const byR2Key = new Map<string, DeltaChainRow[]>();
    for (const row of chain) {
      const existing = byR2Key.get(row.r2_key);
      if (existing) {
        existing.push(row);
      } else {
        byR2Key.set(row.r2_key, [row]);
      }
    }

    const ranges: CoalescedRange[] = [];

    for (const [r2Key, rows] of byR2Key) {
      // Sort by pack_offset
      rows.sort((a, b) => a.pack_offset - b.pack_offset);

      let currentRange: CoalescedRange | null = null;

      for (const row of rows) {
        const rowEnd = row.pack_offset + row.compressed_size;

        if (currentRange) {
          const currentEnd = currentRange.offset + currentRange.length;
          const gap = row.pack_offset - currentEnd;

          if (gap <= COALESCE_GAP_THRESHOLD) {
            // Coalesce: extend current range to include this object
            currentRange.length = rowEnd - currentRange.offset;
            currentRange.objects.push({
              oid: row.oid,
              relativeOffset: row.pack_offset - currentRange.offset,
              compressedSize: row.compressed_size,
            });
          } else {
            // Gap too large: finalize current range, start new one
            ranges.push(currentRange);
            currentRange = {
              r2Key,
              offset: row.pack_offset,
              length: row.compressed_size,
              objects: [
                {
                  oid: row.oid,
                  relativeOffset: 0,
                  compressedSize: row.compressed_size,
                },
              ],
            };
          }
        } else {
          // Start new range
          currentRange = {
            r2Key,
            offset: row.pack_offset,
            length: row.compressed_size,
            objects: [
              {
                oid: row.oid,
                relativeOffset: 0,
                compressedSize: row.compressed_size,
              },
            ],
          };
        }
      }

      if (currentRange) {
        ranges.push(currentRange);
      }
    }

    return ranges;
  }

  /**
   * Fetch and decompress all objects in a delta chain using coalesced parallel R2 requests.
   */
  private async fetchChainObjects(
    chain: DeltaChainRow[],
    oid: string
  ): Promise<Result<Map<string, Uint8Array>, ObjectStoreError>> {
    const ranges = this.buildCoalescedRanges(chain);

    const fetchResults = await Promise.all(
      ranges.map(async (range) => {
        const r2Result = await this.r2.get(range.r2Key, {
          range: {
            offset: range.offset,
            length: range.length,
          },
        });

        if (r2Result.isErr()) {
          return Result.err(
            new ObjectStoreError({
              code: "R2_ERROR",
              message: `R2 error for range at ${range.r2Key}:${range.offset}: ${r2Result.error.message}`,
              oid,
            })
          );
        }

        const buffer = new Uint8Array(await r2Result.value.arrayBuffer());
        return Result.ok({ range, buffer });
      })
    );

    return Result.gen(function* () {
      const objectDataMap = new Map<string, Uint8Array>();

      for (const result of fetchResults) {
        const { range, buffer } = yield* result;

        for (const obj of range.objects) {
          const compressedData = buffer.subarray(
            obj.relativeOffset,
            obj.relativeOffset + obj.compressedSize
          );

          const decompressed = yield* Result.try({
            try: () => inflateSync(compressedData),
            catch: (cause) =>
              new ObjectStoreError({
                code: "DECOMPRESS_ERROR",
                message: `Decompression error for "${obj.oid}": ${String(cause)}`,
                oid,
              }),
          });

          objectDataMap.set(obj.oid, decompressed);
        }
      }

      return Result.ok(objectDataMap);
    });
  }

  /**
   * Read and fully resolve an object by OID.
   *
   * Uses a recursive CTE to fetch the entire delta chain in a single query,
   * then applies deltas from base to target.
   */
  async read(oid: string): Promise<Result<ResolvedObject, ObjectStoreError>> {
    return Result.gen(
      async function* (this: ObjectStore) {
        const chain = yield* Result.await(this.fetchDeltaChain(oid));

        if (chain.length === 0) {
          return Result.err(
            new ObjectStoreError({
              code: "NOT_FOUND",
              message: `Object "${oid}" not found`,
              oid,
            })
          );
        }

        const baseRow = chain.at(-1);
        if (!baseRow) {
          return Result.err(
            new ObjectStoreError({
              code: "NOT_FOUND",
              message: `Object "${oid}" not found`,
              oid,
            })
          );
        }

        if (baseRow.is_delta && baseRow.base_oid) {
          if (baseRow.depth >= MAX_DELTA_DEPTH - 1) {
            return Result.err(
              new ObjectStoreError({
                code: "DELTA_DEPTH_EXCEEDED",
                message: `Delta chain too deep (max ${MAX_DELTA_DEPTH})`,
                oid,
              })
            );
          }
          return Result.err(
            new ObjectStoreError({
              code: "NOT_FOUND",
              message: `Delta base "${baseRow.base_oid}" not found`,
              oid,
            })
          );
        }

        const seenOids = new Set<string>();
        for (const row of chain) {
          if (seenOids.has(row.oid)) {
            return Result.err(
              new ObjectStoreError({
                code: "CYCLE_DETECTED",
                message: `Delta cycle detected at "${row.oid}"`,
                oid,
              })
            );
          }
          seenOids.add(row.oid);
        }

        const objectDataMap = yield* Result.await(
          this.fetchChainObjects(chain, oid)
        );

        let currentData = objectDataMap.get(baseRow.oid);
        if (!currentData) {
          return Result.err(
            new ObjectStoreError({
              code: "NOT_FOUND",
              message: `Base object data missing for "${baseRow.oid}"`,
              oid,
            })
          );
        }
        const baseType = baseRow.type as GitObjectType;

        for (let i = chain.length - 2; i >= 0; i -= 1) {
          const deltaRow = chain[i];
          const deltaData = objectDataMap.get(deltaRow.oid);
          if (!deltaData) {
            return Result.err(
              new ObjectStoreError({
                code: "NOT_FOUND",
                message: `Delta object data missing for "${deltaRow.oid}"`,
                oid,
              })
            );
          }

          const deltaResult = Delta.apply(currentData, deltaData);
          if (deltaResult.isErr()) {
            return Result.err(
              new ObjectStoreError({
                code: "DELTA_ERROR",
                message: `Delta error at "${deltaRow.oid}": ${deltaResult.error.message}`,
                oid,
              })
            );
          }

          currentData = deltaResult.value;
        }

        return Result.ok({
          oid,
          type: baseType,
          data: currentData,
        });
      }.bind(this)
    );
  }
}
