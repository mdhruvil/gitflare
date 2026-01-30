import { Result } from "better-result";
import { ProtocolError } from "@/git/errors";
import { PktLine } from "@/git/pkt";
import { concatUint8Arrays } from "@/lib/bytes";

export type Command = {
  oldOid: string;
  newOid: string;
  ref: string;
};

export type ReceivePackRequest = {
  commands: Command[];
  capabilities: string[];
  packfileStream: ReadableStream<Uint8Array> | null;
};

const ZERO_OID = "0000000000000000000000000000000000000000";

export async function parseReceivePackRequest(
  stream: ReadableStream<Uint8Array>
): Promise<Result<ReceivePackRequest, ProtocolError>> {
  const reader = stream.getReader();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let flushEndOffset = -1;

  while (flushEndOffset === -1) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    totalBytes += value.length;

    flushEndOffset = findFlushOffset(chunks, totalBytes);
  }

  const allData = concatUint8Arrays(chunks, totalBytes);

  if (flushEndOffset === -1) {
    const parseResult = parseCommandsFromBuffer(allData);
    if (parseResult.isErr()) {
      reader.releaseLock();
      return Result.err(parseResult.error);
    }
    reader.releaseLock();
    return Result.ok({
      commands: parseResult.value.commands,
      capabilities: parseResult.value.capabilities,
      packfileStream: null,
    });
  }

  const commandData = allData.subarray(0, flushEndOffset);
  const remainder = allData.subarray(flushEndOffset);

  const parseResult = parseCommandsFromBuffer(commandData);
  if (parseResult.isErr()) {
    reader.releaseLock();
    return Result.err(parseResult.error);
  }

  const { commands, capabilities } = parseResult.value;
  const hasNonDeleteCommand = commands.some((cmd) => cmd.newOid !== ZERO_OID);

  if (!hasNonDeleteCommand && remainder.length === 0) {
    reader.releaseLock();
    return Result.ok({ commands, capabilities, packfileStream: null });
  }

  const packfileStream = createPackfileStream(reader, remainder);
  return Result.ok({ commands, capabilities, packfileStream });
}

function findFlushOffset(chunks: Uint8Array[], totalLength: number): number {
  const data = concatUint8Arrays(chunks, totalLength);
  let offset = 0;

  while (offset + 4 <= data.length) {
    const lengthHex = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    );

    if (lengthHex === PktLine.FLUSH) {
      return offset + 4;
    }

    if (lengthHex === PktLine.DELIM || lengthHex === PktLine.RESPONSE_END) {
      offset += 4;
      continue;
    }

    const packetLen = Number.parseInt(lengthHex, 16);
    if (Number.isNaN(packetLen) || packetLen < 4) {
      offset += 4;
      continue;
    }

    if (offset + packetLen > data.length) {
      return -1;
    }

    offset += packetLen;
  }

  return -1;
}

type ParsedCommands = {
  commands: Command[];
  capabilities: string[];
};

function parseCommandsFromBuffer(
  data: Uint8Array
): Result<ParsedCommands, ProtocolError> {
  const commands: Command[] = [];
  let capabilities: string[] = [];

  let offset = 0;
  while (offset + 4 <= data.length) {
    const lengthHex = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    );

    if (lengthHex === PktLine.FLUSH) {
      break;
    }

    if (lengthHex === PktLine.DELIM || lengthHex === PktLine.RESPONSE_END) {
      offset += 4;
      continue;
    }

    const packetLen = Number.parseInt(lengthHex, 16);
    if (Number.isNaN(packetLen)) {
      return Result.err(
        new ProtocolError({
          code: "INVALID_PKT_LINE",
          detail: `invalid hex length: ${lengthHex}`,
        })
      );
    }

    if (packetLen < 4) {
      return Result.err(
        new ProtocolError({
          code: "INVALID_PKT_LINE",
          detail: `packet length too small: ${packetLen}`,
        })
      );
    }

    if (offset + packetLen > data.length) {
      break;
    }

    const payload = data.subarray(offset + 4, offset + packetLen);
    offset += packetLen;

    const line = PktLine.decodeText(payload).trim();

    const nullIdx = line.indexOf("\0");
    const refLine = nullIdx >= 0 ? line.substring(0, nullIdx) : line;
    const caps = nullIdx >= 0 ? line.substring(nullIdx + 1).split(" ") : [];

    const parts = refLine.split(" ");
    if (parts.length < 3) {
      return Result.err(
        new ProtocolError({
          code: "MALFORMED_COMMAND",
          detail: `expected 3 parts, got: ${parts.length}`,
        })
      );
    }

    commands.push({
      oldOid: parts[0],
      newOid: parts[1],
      ref: parts[2],
    });

    if (caps.length > 0 && capabilities.length === 0) {
      capabilities = caps;
    }
  }

  return Result.ok({ commands, capabilities });
}

function createPackfileStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialChunk: Uint8Array
): ReadableStream<Uint8Array> {
  let initialChunkSent = initialChunk.length === 0;

  return new ReadableStream({
    async pull(controller) {
      if (!initialChunkSent) {
        controller.enqueue(initialChunk);
        initialChunkSent = true;
        return;
      }

      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel();
    },
  });
}

export function encodeUnpackStatus(
  success: boolean,
  error?: string
): Uint8Array {
  if (success) {
    return PktLine.encode("unpack ok\n");
  }
  return PktLine.encode(`unpack ${error ?? "unknown error"}\n`);
}

export function encodeRefStatus(
  ref: string,
  success: boolean,
  error?: string
): Uint8Array {
  if (success) {
    return PktLine.encode(`ok ${ref}\n`);
  }
  return PktLine.encode(`ng ${ref} ${error ?? "failed"}\n`);
}
