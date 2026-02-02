/**
 * Streaming pack file generation for upload-pack.
 *
 * Designed for CF Workers constraints:
 * - 128MB memory limit → cannot buffer full pack
 * - Must stream → write header, then objects one-by-one
 * - SHA1 checksum → incremental hash as we write
 *
 * Pack format:
 * - 4 bytes: "PACK" magic
 * - 4 bytes: version (2) big-endian
 * - 4 bytes: object count big-endian
 * - [object entries...] variable
 * - 20 bytes: SHA1 checksum of all preceding bytes
 */

import { createHash, type Hash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { Result, TaggedError } from "better-result";
import type { GitObjectType } from "@/git/object";

const PACK_MAGIC = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
const PACK_VERSION = 2;

const TYPE_TO_NUM: Record<GitObjectType, number> = {
  commit: 1,
  tree: 2,
  blob: 3,
  tag: 4,
};

export class PackWriteError extends TaggedError("PackWriteError")<{
  message: string;
}>() {}

/**
 * Incremental SHA1 hasher for pack checksum.
 * Wraps node:crypto's createHash with a simpler interface.
 */
class IncrementalSha1 {
  private readonly hasher: Hash;

  constructor() {
    this.hasher = createHash("sha1");
  }

  update(chunk: Uint8Array): void {
    this.hasher.update(chunk);
  }

  digest(): Uint8Array {
    return new Uint8Array(this.hasher.digest());
  }
}

/**
 * Streaming pack file writer.
 *
 * Usage:
 * ```typescript
 * const writer = new PackStreamWriter(writable, objectCount);
 * await writer.writeHeader();
 * for (const obj of objects) {
 *   await writer.writeObject(obj.type, obj.data);
 * }
 * await writer.finalize();
 * ```
 */
export class PackStreamWriter {
  private readonly sha1: IncrementalSha1;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly objectCount: number;
  private written = 0;

  constructor(writable: WritableStream<Uint8Array>, objectCount: number) {
    this.sha1 = new IncrementalSha1();
    this.writer = writable.getWriter();
    this.objectCount = objectCount;
  }

  /**
   * Write pack header (magic + version + object count).
   * Must be called before any writeObject calls.
   */
  async writeHeader(): Promise<Result<void, PackWriteError>> {
    return Result.tryPromise({
      try: async () => {
        const header = new Uint8Array(12);

        // Magic "PACK"
        header.set(PACK_MAGIC, 0);

        // Version 2 (big-endian)
        header[4] = 0;
        header[5] = 0;
        header[6] = 0;
        header[7] = PACK_VERSION;

        // Object count (big-endian)
        header[8] = (this.objectCount >>> 24) & 0xff;
        header[9] = (this.objectCount >>> 16) & 0xff;
        header[10] = (this.objectCount >>> 8) & 0xff;
        header[11] = this.objectCount & 0xff;

        await this.write(header);
      },
      catch: (cause) =>
        new PackWriteError({
          message: `Failed to write pack header: ${String(cause)}`,
        }),
    });
  }

  /**
   * Write a single object entry.
   *
   * Object entry format:
   * - Variable-length type+size header
   * - zlib-compressed data
   */
  async writeObject(
    type: GitObjectType,
    data: Uint8Array
  ): Promise<Result<void, PackWriteError>> {
    return Result.tryPromise({
      try: async () => {
        const typeNum = TYPE_TO_NUM[type];
        const size = data.length;

        // Encode type+size header
        const header = encodeTypeSize(typeNum, size);

        // Compress data
        const compressed = deflateSync(data);

        // Write header + compressed data
        await this.write(header);
        await this.write(compressed);

        this.written += 1;
      },
      catch: (cause) =>
        new PackWriteError({
          message: `Failed to write object: ${String(cause)}`,
        }),
    });
  }

  /**
   * Finalize the pack by writing the SHA1 checksum.
   * Must be called after all objects are written.
   */
  async finalize(): Promise<Result<void, PackWriteError>> {
    if (this.written !== this.objectCount) {
      return Result.err(
        new PackWriteError({
          message: `Object count mismatch: expected ${this.objectCount}, wrote ${this.written}`,
        })
      );
    }

    return Result.tryPromise({
      try: async () => {
        const checksum = this.sha1.digest();
        await this.writer.write(checksum);
        await this.writer.close();
      },
      catch: (cause) =>
        new PackWriteError({
          message: `Failed to finalize pack: ${String(cause)}`,
        }),
    });
  }

  /**
   * Close the writer without finalizing (for error cleanup).
   */
  async abort(): Promise<void> {
    try {
      await this.writer.abort();
    } catch {
      // Ignore abort errors
    }
  }

  /**
   * Get the number of objects written so far.
   */
  get writtenCount(): number {
    return this.written;
  }

  /**
   * Write data to the stream and update the SHA1 hash.
   */
  private async write(chunk: Uint8Array): Promise<void> {
    this.sha1.update(chunk);
    await this.writer.write(chunk);
  }
}

/**
 * Encode type and size into variable-length header.
 *
 * Format:
 * - First byte: bits 4-6 = type, bits 0-3 = size bits 0-3, bit 7 = continuation
 * - Subsequent bytes: bits 0-6 = size bits, bit 7 = continuation
 */
function encodeTypeSize(type: number, size: number): Uint8Array {
  const bytes: number[] = [];

  // First byte: type in bits 4-6, low 4 bits of size in bits 0-3
  let byte = (type << 4) | (size & 0x0f);
  let remaining = size >>> 4;

  while (remaining > 0) {
    bytes.push(byte | 0x80); // Set continuation bit
    byte = remaining & 0x7f;
    remaining >>>= 7;
  }

  bytes.push(byte); // Final byte without continuation bit

  return new Uint8Array(bytes);
}

/**
 * Create a TransformStream that wraps pack data in sideband format.
 *
 * Sideband format: pkt-line with first byte indicating channel
 * - Channel 1: pack data
 * - Channel 2: progress messages
 * - Channel 3: error messages
 *
 * Max pkt-line payload is 65516 bytes (65520 - 4 byte length prefix).
 * With sideband channel byte, max data per packet is 65515 bytes.
 */
export function createSidebandStream(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const MAX_DATA_PER_PACKET = 65_515;

  return new TransformStream({
    transform(chunk, controller) {
      let offset = 0;

      while (offset < chunk.length) {
        const remaining = chunk.length - offset;
        const chunkSize = Math.min(remaining, MAX_DATA_PER_PACKET);
        const packetLen = chunkSize + 5; // 4 byte length + 1 byte channel + data

        // Encode packet length as 4 hex digits
        const lenHex = packetLen.toString(16).padStart(4, "0");
        const header = new TextEncoder().encode(lenHex);

        // Build packet: length + channel(1) + data
        const packet = new Uint8Array(packetLen);
        packet.set(header, 0);
        packet[4] = 0x01; // Channel 1 = pack data
        packet.set(chunk.subarray(offset, offset + chunkSize), 5);

        controller.enqueue(packet);
        offset += chunkSize;
      }
    },
  });
}

/**
 * Encode a progress message in sideband format (channel 2).
 */
export function encodeSidebandProgress(message: string): Uint8Array {
  const data = new TextEncoder().encode(message);
  const packetLen = data.length + 5; // 4 byte length + 1 byte channel + data
  const lenHex = packetLen.toString(16).padStart(4, "0");
  const header = new TextEncoder().encode(lenHex);

  const packet = new Uint8Array(packetLen);
  packet.set(header, 0);
  packet[4] = 0x02; // Channel 2 = progress
  packet.set(data, 5);

  return packet;
}

/**
 * Encode an error message in sideband format (channel 3).
 */
export function encodeSidebandError(message: string): Uint8Array {
  const data = new TextEncoder().encode(message);
  const packetLen = data.length + 5;
  const lenHex = packetLen.toString(16).padStart(4, "0");
  const header = new TextEncoder().encode(lenHex);

  const packet = new Uint8Array(packetLen);
  packet.set(header, 0);
  packet[4] = 0x03; // Channel 3 = error
  packet.set(data, 5);

  return packet;
}
