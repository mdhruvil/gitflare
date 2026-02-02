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
 * Get the length of a packfile object header.
 *
 * Header format: first byte has type in bits 4-6, size bits 0-3 in bits 0-3.
 * If bit 7 is set, more bytes follow (each contributing 7 bits to size).
 */
function getObjectHeaderLength(data: Uint8Array): number {
  let len = 1;
  while (len < data.length && (data[len - 1] & 0x80) !== 0) {
    len += 1;
  }
  return len;
}

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
  | "DB_ERROR"
  | "BATCH_ERROR";

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
    isDelta: boolean;
  }>;
};

/**
 * Object metadata from git_object_index with pack location info.
 */
export type ObjectIndexEntry = {
  oid: string;
  type: GitObjectType;
  packId: string;
  packOffset: number;
  compressedSize: number;
  isDelta: boolean;
  baseOid: string | null;
};

/**
 * Batch read entry with pack and R2 info for coalescing.
 * Includes R2 key so we can group by packfile without additional DB lookups.
 */
export type BatchEntry = {
  oid: string;
  type: GitObjectType;
  packId: string;
  packOffset: number;
  compressedSize: number;
  isDelta: boolean;
  baseOid: string | null;
  r2Key: string;
};

/**
 * Coalesced range for batch reading (includes type info for each object).
 */
type BatchCoalescedRange = {
  r2Key: string;
  offset: number;
  length: number;
  objects: Array<{
    oid: string;
    type: GitObjectType;
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
   * Get batch entries for a list of OIDs with R2 keys.
   * Used by upload-pack to prepare objects for readBatch().
   *
   * Objects are returned ordered by packId, packOffset for optimal R2 access.
   * Batches queries to avoid SQLite statement length limits.
   */
  getBatchEntries(oids: string[]): BatchEntry[] {
    if (oids.length === 0) {
      return [];
    }

    type Row = {
      oid: string;
      type: string;
      pack_id: string;
      pack_offset: number;
      compressed_size: number;
      is_delta: number;
      base_oid: string | null;
      r2_key: string;
    };

    const allRows: Row[] = [];
    const BATCH_SIZE = 100; // SQLite limits bound parameters to 999

    // Query in batches to avoid SQLite statement length limits
    for (let i = 0; i < oids.length; i += BATCH_SIZE) {
      const batch = oids.slice(i, i + BATCH_SIZE);
      const rows = this.db.all<Row>(sql`
        SELECT 
          o.oid,
          o.type,
          o.pack_id,
          o.pack_offset,
          o.compressed_size,
          o.is_delta,
          o.base_oid,
          p.r2_key
        FROM git_object_index o
        JOIN git_packs p ON o.pack_id = p.pack_id
        WHERE o.oid IN (${sql.join(
          batch.map((oid) => sql`${oid}`),
          sql`, `
        )})
      `);
      allRows.push(...rows);
    }

    // Sort by pack_id, pack_offset for optimal R2 access
    allRows.sort((a, b) => {
      if (a.pack_id !== b.pack_id) return a.pack_id.localeCompare(b.pack_id);
      return a.pack_offset - b.pack_offset;
    });

    return allRows.map((row) => ({
      oid: row.oid,
      type: row.type as GitObjectType,
      packId: row.pack_id,
      packOffset: row.pack_offset,
      compressedSize: row.compressed_size,
      isDelta: row.is_delta === 1,
      baseOid: row.base_oid,
      r2Key: row.r2_key,
    }));
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
              isDelta: row.is_delta === 1,
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
                  isDelta: row.is_delta === 1,
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
                isDelta: row.is_delta === 1,
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
          const entryData = buffer.subarray(
            obj.relativeOffset,
            obj.relativeOffset + obj.compressedSize
          );

          // Skip the variable-length type+size header to get to zlib data
          // For ref_delta objects, also skip the 20-byte base OID
          let headerLen = getObjectHeaderLength(entryData);
          if (obj.isDelta) {
            headerLen += 20; // ref_delta has 20-byte base hash after header
          }
          const compressedData = entryData.subarray(headerLen);

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

  /**
   * Read multiple objects in batch with packfile-aware coalescing.
   *
   * Objects are grouped by packfile and sorted by offset to minimize R2 requests.
   * Nearby objects within COALESCE_GAP_THRESHOLD are fetched in single range requests.
   *
   * Calls onObject for each resolved object (allows streaming without holding all in memory).
   * Objects with delta chains are fully resolved before being emitted.
   *
   * @param entries - Object metadata with pack location info (from object-walk)
   * @param onObject - Callback for each resolved object
   * @returns Count of successfully processed objects
   */
  async readBatch(
    entries: BatchEntry[],
    onObject: (obj: ResolvedObject) => Promise<void>
  ): Promise<Result<number, ObjectStoreError>> {
    if (entries.length === 0) {
      return Result.ok(0);
    }

    // Separate delta and non-delta objects
    const nonDeltas: BatchEntry[] = [];
    const deltas: BatchEntry[] = [];

    for (const entry of entries) {
      if (entry.isDelta) {
        deltas.push(entry);
      } else {
        nonDeltas.push(entry);
      }
    }

    let processed = 0;

    // Process non-delta objects in coalesced batches
    const nonDeltaResult = await this.readBatchNonDelta(nonDeltas, onObject);
    if (nonDeltaResult.isErr()) {
      return nonDeltaResult;
    }
    processed += nonDeltaResult.value;

    // Process delta objects individually (need full chain resolution)
    for (const entry of deltas) {
      const result = await this.read(entry.oid);
      if (result.isErr()) {
        return Result.err(
          new ObjectStoreError({
            code: "BATCH_ERROR",
            message: `Failed to resolve delta object: ${result.error.message}`,
            oid: entry.oid,
          })
        );
      }
      await onObject(result.value);
      processed += 1;
    }

    return Result.ok(processed);
  }

  /**
   * Read non-delta objects in coalesced batches.
   */
  private async readBatchNonDelta(
    entries: BatchEntry[],
    onObject: (obj: ResolvedObject) => Promise<void>
  ): Promise<Result<number, ObjectStoreError>> {
    if (entries.length === 0) {
      return Result.ok(0);
    }

    // Build coalesced ranges grouped by packfile
    const ranges = this.buildBatchCoalescedRanges(entries);
    let processed = 0;

    // Process each range
    for (const range of ranges) {
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
            oid: range.objects[0]?.oid ?? "unknown",
          })
        );
      }

      const buffer = new Uint8Array(await r2Result.value.arrayBuffer());

      // Extract and decompress each object in the range
      for (const obj of range.objects) {
        const entryData = buffer.subarray(
          obj.relativeOffset,
          obj.relativeOffset + obj.compressedSize
        );

        // Skip the variable-length type+size header to get to zlib data
        const headerLen = getObjectHeaderLength(entryData);
        const compressedData = entryData.subarray(headerLen);

        let decompressed: Uint8Array;
        try {
          decompressed = inflateSync(compressedData);
        } catch (cause) {
          return Result.err(
            new ObjectStoreError({
              code: "DECOMPRESS_ERROR",
              message: `Decompression error for "${obj.oid}": ${String(cause)}`,
              oid: obj.oid,
            })
          );
        }

        await onObject({
          oid: obj.oid,
          type: obj.type,
          data: decompressed,
        });
        processed += 1;
      }
    }

    return Result.ok(processed);
  }

  /**
   * Build coalesced ranges for batch reading.
   * Groups entries by R2 key and merges nearby objects into single range requests.
   */
  private buildBatchCoalescedRanges(
    entries: BatchEntry[]
  ): BatchCoalescedRange[] {
    // Group by r2Key (packfile)
    const byR2Key = new Map<string, BatchEntry[]>();
    for (const entry of entries) {
      const existing = byR2Key.get(entry.r2Key);
      if (existing) {
        existing.push(entry);
      } else {
        byR2Key.set(entry.r2Key, [entry]);
      }
    }

    const ranges: BatchCoalescedRange[] = [];

    for (const [r2Key, packEntries] of byR2Key) {
      // Sort by pack_offset for sequential access
      packEntries.sort((a, b) => a.packOffset - b.packOffset);

      let currentRange: BatchCoalescedRange | null = null;

      for (const entry of packEntries) {
        const entryEnd = entry.packOffset + entry.compressedSize;

        if (currentRange) {
          const currentEnd = currentRange.offset + currentRange.length;
          const gap = entry.packOffset - currentEnd;

          if (gap <= COALESCE_GAP_THRESHOLD) {
            // Coalesce: extend current range
            currentRange.length = entryEnd - currentRange.offset;
            currentRange.objects.push({
              oid: entry.oid,
              type: entry.type,
              relativeOffset: entry.packOffset - currentRange.offset,
              compressedSize: entry.compressedSize,
            });
          } else {
            // Gap too large: finalize current range, start new one
            ranges.push(currentRange);
            currentRange = {
              r2Key,
              offset: entry.packOffset,
              length: entry.compressedSize,
              objects: [
                {
                  oid: entry.oid,
                  type: entry.type,
                  relativeOffset: 0,
                  compressedSize: entry.compressedSize,
                },
              ],
            };
          }
        } else {
          // Start new range
          currentRange = {
            r2Key,
            offset: entry.packOffset,
            length: entry.compressedSize,
            objects: [
              {
                oid: entry.oid,
                type: entry.type,
                relativeOffset: 0,
                compressedSize: entry.compressedSize,
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
}
