/**
 * Upload-pack handler for git fetch/clone operations.
 *
 * Implements Git protocol v2 commands:
 * - ls-refs: List available refs with optional filtering
 * - fetch: Negotiate and send packfile
 */

import { Result, TaggedError } from "better-result";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { ObjectStore } from "@/do/object-store";
import type { RefStore, Ref as StoredRef } from "@/do/ref-store";
import type * as schema from "@/do/schema/git";
import {
  encodeAcknowledgments,
  encodeLsRefsResponse,
  encodePackfileSection,
  type FetchRequest,
  type LsRefsRequest,
  type Ref as ProtocolRef,
  parseCommand,
} from "@/git/protocol/upload-pack-v2";
import { gitResponse, gitStreamResponse } from "@/git/response";
import {
  filterExistingOids,
  getAllObjectsForClone,
  type WalkOptions,
  walkObjectsIncremental,
} from "@/git/upload-pack/object-walk";
import {
  createSidebandStream,
  encodeSidebandError,
  encodeSidebandProgress,
  PackStreamWriter,
} from "@/git/upload-pack/pack-stream";

type DB = DrizzleSqliteDODatabase<typeof schema>;

export class UploadPackError extends TaggedError("UploadPackError")<{
  code:
    | "PROTOCOL_ERROR"
    | "INVALID_WANT"
    | "TRAVERSAL_ERROR"
    | "PACK_ERROR"
    | "INTERNAL_ERROR";
  message: string;
}>() {}

export type UploadPackContext = {
  db: DB;
  refs: RefStore;
  objects: ObjectStore;
  waitUntil: (promise: Promise<unknown>) => void;
};

/**
 * Handle an upload-pack v2 request.
 * Routes to appropriate command handler based on parsed command.
 */
export async function handleUploadPackV2(
  ctx: UploadPackContext,
  requestBody: ReadableStream<Uint8Array>
): Promise<Result<Response, UploadPackError>> {
  const commandResult = await parseCommand(requestBody);
  if (commandResult.isErr()) {
    return Result.err(
      new UploadPackError({
        code: "PROTOCOL_ERROR",
        message: commandResult.error.message,
      })
    );
  }

  const command = commandResult.value;

  switch (command.type) {
    case "ls-refs":
      return handleLsRefs(ctx, command.args);
    case "fetch":
      return handleFetch(ctx, command.args);
    default: {
      const exhaustive: never = command;
      return Result.err(
        new UploadPackError({
          code: "PROTOCOL_ERROR",
          message: `Unknown command: ${(exhaustive as { type: string }).type}`,
        })
      );
    }
  }
}

/**
 * Handle ls-refs command.
 * Returns list of refs with optional symref targets and peeled OIDs.
 */
async function handleLsRefs(
  ctx: UploadPackContext,
  args: LsRefsRequest
): Promise<Result<Response, UploadPackError>> {
  const refsResult = await ctx.refs.list();
  if (refsResult.isErr()) {
    return Result.err(
      new UploadPackError({
        code: "INTERNAL_ERROR",
        message: refsResult.error.message,
      })
    );
  }

  const allRefs = refsResult.value;

  // Filter by prefixes if specified
  let filtered: StoredRef[] = allRefs;
  if (args.refPrefixes.length > 0) {
    filtered = allRefs.filter((r) =>
      args.refPrefixes.some((p) => r.name.startsWith(p))
    );
  }

  // Convert to protocol format
  // For symbolic refs, value contains the target ref name
  const refs: ProtocolRef[] = filtered.map((r) => ({
    name: r.name,
    oid: r.value,
    symrefTarget: r.isSymbolic ? r.value : undefined,
  }));

  const response = encodeLsRefsResponse(refs, {
    peel: args.peel,
    symrefs: args.symrefs,
  });

  return Result.ok(gitResponse(response, "upload-pack", "result"));
}

/**
 * Handle fetch command.
 * Two modes:
 * - Negotiation (no 'done'): Return acknowledgments
 * - Final (with 'done'): Send packfile
 */
async function handleFetch(
  ctx: UploadPackContext,
  req: FetchRequest
): Promise<Result<Response, UploadPackError>> {
  // Validate wants against advertised refs
  const refsResult = await ctx.refs.list();
  if (refsResult.isErr()) {
    return Result.err(
      new UploadPackError({
        code: "INTERNAL_ERROR",
        message: refsResult.error.message,
      })
    );
  }

  const advertisedOids = new Set(refsResult.value.map((r) => r.value));

  for (const want of req.wants) {
    if (!advertisedOids.has(want)) {
      return Result.err(
        new UploadPackError({
          code: "INVALID_WANT",
          message: `Object ${want} was not advertised`,
        })
      );
    }
  }

  // If no 'done', return acknowledgments only (negotiation phase)
  if (!req.done) {
    return handleFetchNegotiation(ctx, req);
  }

  // Client sent 'done' - send packfile
  return handleFetchWithPack(ctx, req);
}

/**
 * Handle fetch negotiation phase.
 * Returns acknowledgments for common objects.
 */
async function handleFetchNegotiation(
  ctx: UploadPackContext,
  req: FetchRequest
): Promise<Result<Response, UploadPackError>> {
  // Check which haves we have in common
  const validHaves = await filterExistingOids(ctx.objects, req.haves);

  // ready=true if we have common objects (can send minimal pack)
  const ready = validHaves.length > 0;

  const response = encodeAcknowledgments(validHaves, ready);

  return Result.ok(gitResponse(response, "upload-pack", "result"));
}

/**
 * Handle fetch with packfile generation.
 * Streams response with acknowledgments + packfile.
 */
function handleFetchWithPack(
  ctx: UploadPackContext,
  req: FetchRequest
): Result<Response, UploadPackError> {
  const { readable, writable } = new TransformStream<Uint8Array>();

  // Process in background, stream response immediately
  ctx.waitUntil(processFetchWithPack(ctx, req, writable));

  return Result.ok(gitStreamResponse(readable, "upload-pack"));
}

/**
 * Process fetch request and write packfile to stream.
 */
async function processFetchWithPack(
  ctx: UploadPackContext,
  req: FetchRequest,
  writable: WritableStream<Uint8Array>
): Promise<void> {
  const writer = writable.getWriter();
  const showProgress = !req.capabilities.noProgress;

  try {
    // Determine if this is a clone (no haves) or incremental fetch
    const isClone = req.haves.length === 0;

    // For incremental fetch, write acknowledgments first
    // For fresh clone (no haves), skip directly to packfile
    if (!isClone) {
      const validHaves = await filterExistingOids(ctx.objects, req.haves);
      const acks = encodeAcknowledgments(validHaves, true, true); // moreFollows=true
      await writer.write(acks);
    }

    // Write packfile section header
    await writer.write(encodePackfileSection());

    // Create sideband transform for pack data
    const sidebandTransform = createSidebandStream();
    const packWritable = sidebandTransform.writable;
    const sidebandReadable = sidebandTransform.readable;

    // Pipe sideband output to response
    const pipePromise = sidebandReadable.pipeTo(
      new WritableStream({
        write: (chunk) => writer.write(chunk),
      })
    );

    // Walk objects and generate pack
    const walkResult = isClone
      ? await getAllObjectsForClone(ctx.db)
      : await walkObjectsIncremental(req.wants, req.haves, {
          db: ctx.db,
          objectStore: ctx.objects,
        } satisfies WalkOptions);

    if (walkResult.isErr()) {
      if (showProgress) {
        await writer.write(
          encodeSidebandError(`Traversal error: ${walkResult.error.message}\n`)
        );
      }
      await packWritable.abort();
      await writer.close();
      return;
    }

    const { objects } = walkResult.value;

    if (showProgress) {
      await writer.write(
        encodeSidebandProgress(
          `Enumerating objects: ${objects.length}, done.\n`
        )
      );
    }

    // Get batch entries with R2 keys
    const batchEntries = ctx.objects.getBatchEntries(objects.map((o) => o.oid));

    // Create pack writer
    const packWriter = new PackStreamWriter(packWritable, batchEntries.length);

    const headerResult = await packWriter.writeHeader();
    if (headerResult.isErr()) {
      if (showProgress) {
        await writer.write(
          encodeSidebandError(`Pack error: ${headerResult.error.message}\n`)
        );
      }
      await packWriter.abort();
      await writer.close();
      return;
    }

    // Write objects via batch reader
    let written = 0;
    const batchResult = await ctx.objects.readBatch(
      batchEntries,
      async (obj) => {
        const writeResult = await packWriter.writeObject(obj.type, obj.data);
        if (writeResult.isErr()) {
          throw new Error(writeResult.error.message);
        }

        written += 1;
        if (showProgress && written % 100 === 0) {
          await writer.write(
            encodeSidebandProgress(
              `Counting objects: ${written}/${batchEntries.length}\r`
            )
          );
        }
      }
    );

    if (batchResult.isErr()) {
      if (showProgress) {
        await writer.write(
          encodeSidebandError(
            `Batch read error: ${batchResult.error.message}\n`
          )
        );
      }
      await packWriter.abort();
      await writer.close();
      return;
    }

    if (showProgress) {
      await writer.write(
        encodeSidebandProgress(
          `Total ${batchEntries.length} (delta 0), reused ${batchEntries.length} (delta 0)\n`
        )
      );
    }

    // Finalize pack (writes SHA1 checksum)
    const finalizeResult = await packWriter.finalize();
    if (finalizeResult.isErr()) {
      if (showProgress) {
        await writer.write(
          encodeSidebandError(
            `Finalize error: ${finalizeResult.error.message}\n`
          )
        );
      }
      await writer.close();
      return;
    }

    // Wait for sideband pipe to complete
    await pipePromise;

    // Write flush packet to end response
    await writer.write(new Uint8Array([0x30, 0x30, 0x30, 0x30])); // "0000"
    await writer.close();
  } catch (err) {
    if (showProgress) {
      await writer.write(
        encodeSidebandError(`Internal error: ${String(err)}\n`)
      );
    }
    try {
      await writer.close();
    } catch {
      // Ignore close errors
    }
  }
}
