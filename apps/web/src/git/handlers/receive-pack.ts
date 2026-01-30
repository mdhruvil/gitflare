import { Result } from "better-result";
import { Keys } from "@/do/keys";
import type { PackIndexer } from "@/do/pack-indexer";
import type { R2 } from "@/do/r2";
import type { RefStore, RefUpdate } from "@/do/ref-store";
import type { ReceivePackError } from "@/git/errors";
import { PktLine } from "@/git/pkt";
import {
  encodeRefStatus,
  encodeUnpackStatus,
  type ReceivePackRequest,
} from "@/git/protocol/receive-pack";
import { ProgressReporter, SidebandWriter } from "@/git/sideband-writer";
import { concatUint8Arrays } from "@/lib/bytes";

export type ReceivePackContext = {
  r2: R2;
  refs: RefStore;
  indexer: PackIndexer;
  repoPath: string;
};

/**
 * Handle a receive-pack request: index packfile, upload to R2, update refs.
 * Returns a streaming response with progress and status.
 */
export function handleReceivePack(
  ctx: ReceivePackContext,
  request: ReceivePackRequest,
  useSideband: boolean
): Result<ReadableStream<Uint8Array>, ReceivePackError> {
  const { commands, packfileStream } = request;

  const refUpdates: RefUpdate[] = commands.map((cmd) => ({
    name: cmd.ref,
    oldOid: cmd.oldOid,
    newOid: cmd.newOid,
  }));

  const atomic = request.capabilities.includes("atomic");

  if (!packfileStream) {
    return Result.ok(createRefOnlyResponse(ctx.refs, refUpdates, atomic));
  }

  const { readable, writable } = new TransformStream<Uint8Array>();

  processReceivePack({
    ctx,
    writable,
    packfileStream,
    refUpdates,
    atomic,
    useSideband,
  });

  return Result.ok(readable);
}

function createRefOnlyResponse(
  refs: RefStore,
  refUpdates: RefUpdate[],
  atomic: boolean
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const results = await refs.applyUpdates(refUpdates);
      const lines: Uint8Array[] = [];

      const allOk = results.every((r) => r.ok);
      if (atomic && !allOk) {
        lines.push(encodeUnpackStatus(false, "atomic transaction failed"));
      } else {
        lines.push(encodeUnpackStatus(true));
      }

      for (const result of results) {
        lines.push(encodeRefStatus(result.name, result.ok, result.error));
      }

      lines.push(PktLine.encodeFlush());
      controller.enqueue(PktLine.mergeLines(lines));
      controller.close();
    },
  });
}

type ProcessReceivePackOpts = {
  ctx: ReceivePackContext;
  writable: WritableStream<Uint8Array>;
  packfileStream: ReadableStream<Uint8Array>;
  refUpdates: RefUpdate[];
  atomic: boolean;
  useSideband: boolean;
};

async function processReceivePack(opts: ProcessReceivePackOpts): Promise<void> {
  const { ctx, writable, packfileStream, refUpdates, atomic, useSideband } =
    opts;
  const writer = writable.getWriter();
  const sideband = new SidebandWriter(writer, useSideband);
  const progress = new ProgressReporter(sideband);

  const packId = `pack-${Date.now()}.pack`;
  const r2Key = Keys.pack(ctx.repoPath, packId);

  const packChunks: Uint8Array[] = [];
  let packSize = 0;

  const collectingStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      packChunks.push(chunk);
      packSize += chunk.length;
      controller.enqueue(chunk);
    },
  });

  const indexerStream = packfileStream.pipeThrough(collectingStream);

  const result = await Result.gen(async function* () {
    yield* Result.await(
      ctx.indexer.index(packId, r2Key, indexerStream, async (event) => {
        await progress.report(event);
      })
    );

    const packData = concatUint8Arrays(packChunks, packSize);
    yield* Result.await(ctx.r2.put(r2Key, packData));

    return Result.ok(undefined);
  });

  if (result.isErr()) {
    await writeErrorResponse(sideband, result.error.message, useSideband);
    await writer.close();
    return;
  }

  const refResults = await ctx.refs.applyUpdates(refUpdates);
  const allOk = refResults.every((r) => r.ok);

  if (atomic && !allOk) {
    await sideband.writeProgress("error: atomic transaction failed\n");
  } else {
    await sideband.writeProgress(
      `Processing changes: refs: ${refUpdates.length}, done.\n`
    );
  }

  await sideband.writeData(encodeUnpackStatus(allOk));

  for (const res of refResults) {
    await sideband.writeData(encodeRefStatus(res.name, res.ok, res.error));
  }

  if (useSideband) {
    await sideband.writeData(PktLine.encodeFlush());
  }
  await sideband.flush();
  await writer.close();
}

async function writeErrorResponse(
  sideband: SidebandWriter,
  message: string,
  useSideband: boolean
): Promise<void> {
  await sideband.writeProgress(`error: ${message}\n`);
  await sideband.writeData(encodeUnpackStatus(false, message));
  if (useSideband) {
    await sideband.writeData(PktLine.encodeFlush());
  }
  await sideband.flush();
}
