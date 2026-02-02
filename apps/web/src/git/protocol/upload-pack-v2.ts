/**
 * Git protocol v2 upload-pack implementation.
 * Handles capability advertisement, ls-refs, and fetch commands.
 *
 * @see https://git-scm.com/docs/protocol-v2
 */

import { Result } from "better-result";
import { ProtocolError } from "@/git/errors";
import { PktLine } from "@/git/pkt";
import { concatUint8Arrays } from "@/lib/bytes";

// Server capabilities advertised during info/refs
const V2_CAPABILITIES = [
  "version 2",
  "ls-refs",
  "fetch",
  "server-option",
] as const;

// Fetch command capabilities (subset we support for MVP)
const FETCH_CAPABILITIES = ["no-progress"] as const;

export type Ref = {
  name: string;
  oid: string;
  symrefTarget?: string;
  peeled?: string;
};

export type LsRefsRequest = {
  peel: boolean;
  symrefs: boolean;
  refPrefixes: string[];
};

export type FetchRequest = {
  wants: string[];
  haves: string[];
  done: boolean;
  capabilities: {
    noProgress: boolean;
  };
};

export type Command =
  | { type: "ls-refs"; args: LsRefsRequest }
  | { type: "fetch"; args: FetchRequest };

/**
 * Advertise v2 capabilities for info/refs response.
 * Called when client sends Git-Protocol: version=2 header.
 *
 * Output format:
 * ```
 * PKT-LINE("version 2\n")
 * PKT-LINE("ls-refs\n")
 * PKT-LINE("fetch\n")
 * PKT-LINE("server-option\n")
 * flush-pkt (0000)
 * ```
 */
export function advertiseV2Capabilities(): Uint8Array {
  const lines: Uint8Array[] = [];

  for (const cap of V2_CAPABILITIES) {
    lines.push(PktLine.encode(`${cap}\n`));
  }

  lines.push(PktLine.encodeFlush());
  return PktLine.mergeLines(lines);
}

/**
 * Advertise fetch capabilities for fetch command response.
 */
export function advertiseFetchCapabilities(): Uint8Array {
  const lines: Uint8Array[] = [];

  for (const cap of FETCH_CAPABILITIES) {
    lines.push(PktLine.encode(`${cap}\n`));
  }

  return PktLine.mergeLines(lines);
}

/**
 * Parse a command from the request body.
 * Expects: `command=<name>` followed by delim-pkt and arguments.
 */
export async function parseCommand(
  stream: ReadableStream<Uint8Array>
): Promise<Result<Command, ProtocolError>> {
  const reader = stream.getReader();

  try {
    // Accumulate chunks until we have the full request (ends with flush-pkt)
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      totalBytes += value.length;

      // Check if we've seen the final flush
      if (hasFlushPacket(chunks, totalBytes)) {
        break;
      }
    }

    const data = concatUint8Arrays(chunks, totalBytes);
    return parseCommandFromBuffer(data);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse ls-refs command arguments from buffer.
 */
export function parseLsRefsRequest(
  packets: string[]
): Result<LsRefsRequest, ProtocolError> {
  const request: LsRefsRequest = {
    peel: false,
    symrefs: false,
    refPrefixes: [],
  };

  for (const line of packets) {
    const trimmed = line.trim();

    if (trimmed === "peel") {
      request.peel = true;
    } else if (trimmed === "symrefs") {
      request.symrefs = true;
    } else if (trimmed.startsWith("ref-prefix ")) {
      const prefix = trimmed.slice("ref-prefix ".length);
      request.refPrefixes.push(prefix);
    }
    // Ignore unknown arguments (forward compatibility)
  }

  return Result.ok(request);
}

/**
 * Parse fetch command arguments from buffer.
 */
export function parseFetchRequest(
  packets: string[]
): Result<FetchRequest, ProtocolError> {
  const request: FetchRequest = {
    wants: [],
    haves: [],
    done: false,
    capabilities: {
      noProgress: false,
    },
  };

  for (const line of packets) {
    const trimmed = line.trim();

    if (trimmed === "done") {
      request.done = true;
    } else if (trimmed === "no-progress") {
      request.capabilities.noProgress = true;
    } else if (trimmed.startsWith("want ")) {
      const oid = trimmed.slice("want ".length).trim();
      if (oid.length === 40) {
        request.wants.push(oid);
      }
    } else if (trimmed.startsWith("have ")) {
      const oid = trimmed.slice("have ".length).trim();
      if (oid.length === 40) {
        request.haves.push(oid);
      }
    }
    // Ignore: thin-pack, ofs-delta, include-tag, etc. (not supported in MVP)
    // TODO: ^^ Handle these capabilities in future iterations
  }

  if (request.wants.length === 0) {
    return Result.err(
      new ProtocolError({
        code: "MALFORMED_COMMAND",
        detail: "fetch command requires at least one want",
      })
    );
  }

  return Result.ok(request);
}

/**
 * Encode ls-refs response.
 *
 * Output format per ref:
 * ```
 * <oid> SP <refname> [SP symref-target:<target>] [SP peeled:<oid>] LF
 * ```
 * Ends with flush-pkt.
 */
export function encodeLsRefsResponse(
  refs: Ref[],
  options: { peel: boolean; symrefs: boolean }
): Uint8Array {
  const lines: Uint8Array[] = [];

  for (const ref of refs) {
    let line = `${ref.oid} ${ref.name}`;

    if (options.symrefs && ref.symrefTarget) {
      line += ` symref-target:${ref.symrefTarget}`;
    }

    if (options.peel && ref.peeled) {
      line += ` peeled:${ref.peeled}`;
    }

    lines.push(PktLine.encode(`${line}\n`));
  }

  lines.push(PktLine.encodeFlush());
  return PktLine.mergeLines(lines);
}

/**
 * Encode acknowledgments section for fetch negotiation.
 *
 * Output format:
 * ```
 * PKT-LINE("acknowledgments\n")
 * PKT-LINE("ACK <oid>\n") for each acknowledged object
 * PKT-LINE("ready\n") if ready to send pack, else PKT-LINE("NAK\n")
 * delim-pkt (0001) if more sections follow, else flush-pkt (0000)
 * ```
 */
export function encodeAcknowledgments(
  acks: string[],
  ready: boolean,
  moreFollows = false
): Uint8Array {
  const lines: Uint8Array[] = [];

  lines.push(PktLine.encode("acknowledgments\n"));

  for (const oid of acks) {
    lines.push(PktLine.encode(`ACK ${oid}\n`));
  }

  if (ready) {
    lines.push(PktLine.encode("ready\n"));
  } else {
    lines.push(PktLine.encode("NAK\n"));
  }

  lines.push(moreFollows ? PktLine.encodeDelim() : PktLine.encodeFlush());
  return PktLine.mergeLines(lines);
}

/**
 * Encode packfile section header.
 * Following data should be sideband-multiplexed.
 *
 * Output: `PKT-LINE("packfile\n")`
 */
export function encodePackfileSection(): Uint8Array {
  return PktLine.encode("packfile\n");
}

/**
 * Encode response-end packet for stateless protocol.
 */
export function encodeResponseEnd(): Uint8Array {
  return PktLine.encodeResponseEnd();
}

// Internal helpers

/**
 * Check if buffer ends with a flush packet (0000).
 */
function hasFlushPacket(chunks: Uint8Array[], totalLength: number): boolean {
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
      // Found flush - check if it's at the end
      return offset + 4 === data.length;
    }

    if (lengthHex === PktLine.DELIM || lengthHex === PktLine.RESPONSE_END) {
      offset += 4;
      continue;
    }

    const packetLen = Number.parseInt(lengthHex, 16);
    if (Number.isNaN(packetLen) || packetLen < 4) {
      return false;
    }

    if (offset + packetLen > data.length) {
      return false;
    }

    offset += packetLen;
  }

  return false;
}

/**
 * Parse command from complete buffer.
 */
function parseCommandFromBuffer(
  data: Uint8Array
): Result<Command, ProtocolError> {
  const packets: string[] = [];
  let commandName: string | undefined;
  let afterDelim = false;
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

    if (lengthHex === PktLine.DELIM) {
      afterDelim = true;
      offset += 4;
      continue;
    }

    if (lengthHex === PktLine.RESPONSE_END) {
      break;
    }

    const packetLen = Number.parseInt(lengthHex, 16);
    if (Number.isNaN(packetLen) || packetLen < 4) {
      return Result.err(
        new ProtocolError({
          code: "INVALID_PKT_LINE",
          detail: `invalid hex length: ${lengthHex}`,
        })
      );
    }

    if (offset + packetLen > data.length) {
      return Result.err(
        new ProtocolError({
          code: "INVALID_PKT_LINE",
          detail: "truncated packet",
        })
      );
    }

    const payload = data.subarray(offset + 4, offset + packetLen);
    const line = PktLine.decodeText(payload).trim();
    offset += packetLen;

    // First packet before delim should be command=<name>
    if (!afterDelim) {
      if (line.startsWith("command=")) {
        commandName = line.slice("command=".length);
      }
      continue;
    }

    // After delim, collect arguments
    packets.push(line);
  }

  if (!commandName) {
    return Result.err(
      new ProtocolError({
        code: "MALFORMED_COMMAND",
        detail: "missing command=<name> packet",
      })
    );
  }

  switch (commandName) {
    case "ls-refs": {
      const argsResult = parseLsRefsRequest(packets);
      if (argsResult.isErr()) return argsResult;
      return Result.ok({ type: "ls-refs", args: argsResult.value });
    }
    case "fetch": {
      const argsResult = parseFetchRequest(packets);
      if (argsResult.isErr()) return argsResult;
      return Result.ok({ type: "fetch", args: argsResult.value });
    }
    default:
      return Result.err(
        new ProtocolError({
          code: "MALFORMED_COMMAND",
          detail: `unknown command: ${commandName}`,
        })
      );
  }
}
