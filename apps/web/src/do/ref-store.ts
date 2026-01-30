/**
 * RefStore: CRUD operations for git refs in SQLite.
 *
 * Handles direct refs (pointing to OIDs) and symbolic refs (pointing to other refs).
 * Supports atomic batch updates with old-value verification for compare-and-swap semantics.
 */

import { Result, TaggedError } from "better-result";
import { eq } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import * as schema from "./schema/git";

const ZERO_OID = "0".repeat(40);
const MAX_SYMBOLIC_DEPTH = 10;

export type Ref = {
  name: string;
  value: string;
  isSymbolic: boolean;
};

export type RefUpdate = {
  name: string;
  oldOid: string;
  newOid: string;
};

export type RefUpdateResult = {
  name: string;
  ok: boolean;
  error?: string;
};

export type RefErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "OLD_OID_MISMATCH"
  | "SYMBOLIC_LOOP"
  | "DB_ERROR";

export class RefError extends TaggedError("RefError")<{
  code: RefErrorCode;
  message: string;
  ref: string;
}>() {}

type DB = DrizzleSqliteDODatabase<typeof schema>;

export class RefStore {
  private readonly db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  async get(name: string): Promise<Result<Ref, RefError>> {
    const result = await Result.tryPromise({
      try: () =>
        this.db.query.gitRefs.findFirst({
          where: eq(schema.gitRefs.name, name),
        }),
      catch: (cause) =>
        new RefError({
          code: "DB_ERROR",
          message: `Database error: ${String(cause)}`,
          ref: name,
        }),
    });

    if (result.isErr()) return result;

    const row = result.value;
    if (!row) {
      return Result.err(
        new RefError({
          code: "NOT_FOUND",
          message: `Ref "${name}" not found`,
          ref: name,
        })
      );
    }

    return Result.ok({
      name: row.name,
      value: row.value,
      isSymbolic: row.isSymbolic,
    });
  }

  async list(): Promise<Result<Ref[], RefError>> {
    return Result.tryPromise({
      try: async () => {
        const rows = await this.db.query.gitRefs.findMany();
        return rows.map((row) => ({
          name: row.name,
          value: row.value,
          isSymbolic: row.isSymbolic,
        }));
      },
      catch: (cause) =>
        new RefError({
          code: "DB_ERROR",
          message: `Database error: ${String(cause)}`,
          ref: "*",
        }),
    });
  }

  async resolve(name: string): Promise<Result<string, RefError>> {
    const seen = new Set<string>();
    let currentName = name;

    for (let depth = 0; depth < MAX_SYMBOLIC_DEPTH; depth += 1) {
      if (seen.has(currentName)) {
        return Result.err(
          new RefError({
            code: "SYMBOLIC_LOOP",
            message: `Symbolic ref loop detected: ${Array.from(seen).join(" -> ")} -> ${currentName}`,
            ref: name,
          })
        );
      }
      seen.add(currentName);

      const refResult = await this.get(currentName);
      if (refResult.isErr()) {
        // Propagate NOT_FOUND with original ref name
        if (refResult.error.code === "NOT_FOUND") {
          return Result.err(
            new RefError({
              code: "NOT_FOUND",
              message: `Ref "${name}" not found (failed at "${currentName}")`,
              ref: name,
            })
          );
        }
        return refResult;
      }

      const ref = refResult.value;
      if (!ref.isSymbolic) {
        return Result.ok(ref.value);
      }

      currentName = ref.value;
    }

    return Result.err(
      new RefError({
        code: "SYMBOLIC_LOOP",
        message: `Symbolic ref chain too deep (max ${MAX_SYMBOLIC_DEPTH})`,
        ref: name,
      })
    );
  }

  /**
   * Apply a batch of ref updates atomically.
   *
   * Each update specifies:
   * - oldOid: expected current value (ZERO_OID for create)
   * - newOid: new value (ZERO_OID for delete)
   *
   * All updates are validated first, then applied in a transaction.
   * If any validation fails, no updates are applied.
   */
  async applyUpdates(updates: RefUpdate[]): Promise<RefUpdateResult[]> {
    if (updates.length === 0) {
      return [];
    }

    const results: RefUpdateResult[] = [];

    // Pre-validate all updates
    const validationErrors = await this.validateUpdates(updates);
    const hasErrors = validationErrors.some((e) => e !== null);

    if (hasErrors) {
      return updates.map((update, i) => ({
        name: update.name,
        ok: validationErrors[i] === null,
        error: validationErrors[i] ?? undefined,
      }));
    }

    // Apply all updates in a transaction
    try {
      await this.db.transaction(async (tx) => {
        for (const update of updates) {
          if (update.newOid === ZERO_OID) {
            await tx
              .delete(schema.gitRefs)
              .where(eq(schema.gitRefs.name, update.name));
          } else if (update.oldOid === ZERO_OID) {
            await tx.insert(schema.gitRefs).values({
              name: update.name,
              value: update.newOid,
              isSymbolic: false,
            });
          } else {
            await tx
              .update(schema.gitRefs)
              .set({ value: update.newOid })
              .where(eq(schema.gitRefs.name, update.name));
          }

          results.push({ name: update.name, ok: true });
        }
      });
    } catch (cause) {
      // Transaction failed - all updates fail
      return updates.map((update) => ({
        name: update.name,
        ok: false,
        error: `Transaction failed: ${String(cause)}`,
      }));
    }

    return results;
  }

  /**
   * Create a symbolic ref.
   *
   * @param name - Name of the symbolic ref (e.g., "HEAD")
   * @param target - Target ref name (e.g., "refs/heads/main")
   */
  async setSymbolic(
    name: string,
    target: string
  ): Promise<Result<void, RefError>> {
    return Result.tryPromise({
      try: async () => {
        await this.db
          .insert(schema.gitRefs)
          .values({
            name,
            value: target,
            isSymbolic: true,
          })
          .onConflictDoUpdate({
            target: schema.gitRefs.name,
            set: { value: target, isSymbolic: true },
          });
      },
      catch: (cause) =>
        new RefError({
          code: "DB_ERROR",
          message: `Database error: ${String(cause)}`,
          ref: name,
        }),
    });
  }

  private async validateUpdates(
    updates: RefUpdate[]
  ): Promise<Array<string | null>> {
    const errors: Array<string | null> = [];

    for (const update of updates) {
      const currentRef = await this.db.query.gitRefs.findFirst({
        where: eq(schema.gitRefs.name, update.name),
      });

      const currentOid = currentRef?.value ?? ZERO_OID;

      if (update.oldOid === ZERO_OID) {
        // Create: ref must not exist
        if (currentRef) {
          errors.push(`Ref "${update.name}" already exists`);
          continue;
        }
      } else if (update.newOid === ZERO_OID) {
        // Delete: ref must exist with matching OID
        if (!currentRef) {
          errors.push(`Ref "${update.name}" not found`);
          continue;
        }
        if (currentOid !== update.oldOid) {
          errors.push(
            `Ref "${update.name}" old value mismatch: expected ${update.oldOid}, got ${currentOid}`
          );
          continue;
        }
      } else {
        // Update: ref must exist with matching OID
        if (!currentRef) {
          errors.push(`Ref "${update.name}" not found`);
          continue;
        }
        if (currentOid !== update.oldOid) {
          errors.push(
            `Ref "${update.name}" old value mismatch: expected ${update.oldOid}, got ${currentOid}`
          );
          continue;
        }
      }

      errors.push(null);
    }

    return errors;
  }
}
