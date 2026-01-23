/**
 * Streaming Git packfile parser.
 *
 * @see https://git-scm.com/docs/pack-format
 */

import { createHash, type Hash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { Result } from "better-result";
import { StreamBuffer } from "@/lib/stream-buffer";
import { PackfileParseError } from "./error";
import type {
  PackfileEvent,
  PackfileHeader,
  PackfileObject,
  PackfileResult,
  Progress,
} from "./types";

const PACK_SIGNATURE = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
const SHA1_LENGTH = 20;
const HEADER_LENGTH = 12; // signature (4) + version (4) + object count (4)

const OBJECT_TYPE_MAP: Record<number, PackfileObject["objectType"]> = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
  6: "ofs_delta",
  7: "ref_delta",
};

export class PackfileParser {
  private readonly buffer: StreamBuffer;
  private readonly hash: Hash;
  private readonly pendingHashData: Uint8Array[] = [];
  private pendingBytes = 0;
  private readonly _progress: Progress = {
    bytesRead: 0,
    objectsParsed: 0,
    objectsTotal: 0,
  };

  constructor(source: ReadableStream<Uint8Array>) {
    this.hash = createHash("sha1");
    // Delay hashing by SHA1_LENGTH bytes so we can exclude the trailing checksum
    this.buffer = new StreamBuffer(source, {
      onData: (chunk) => {
        this.pendingHashData.push(chunk);
        this.pendingBytes += chunk.length;
        this.flushPendingHash();
      },
    });
  }

  /** Flush pending data to hash, keeping SHA1_LENGTH bytes buffered */
  private flushPendingHash(): void {
    while (this.pendingBytes > SHA1_LENGTH && this.pendingHashData.length > 0) {
      const chunk = this.pendingHashData[0];
      const available = this.pendingBytes - SHA1_LENGTH;

      if (chunk.length <= available) {
        // Entire chunk can be hashed
        this.hash.update(chunk);
        this.pendingHashData.shift();
        this.pendingBytes -= chunk.length;
      } else {
        // Partial chunk - hash only what we can
        const toHash = chunk.subarray(0, available);
        this.hash.update(toHash);
        this.pendingHashData[0] = chunk.subarray(available);
        this.pendingBytes -= available;
        break;
      }
    }
  }

  get progress(): Progress {
    return { ...this._progress };
  }

  async *parse(): AsyncIterable<Result<PackfileEvent, PackfileParseError>> {
    const headerResult = await this.parseHeader();
    yield headerResult;
    if (headerResult.isErr()) return;

    const header = headerResult.value;
    this._progress.objectsTotal = header.objectCount;

    for (let i = 0; i < header.objectCount; i += 1) {
      const objectResult = await this.parseObject();
      this._progress.bytesRead = this.buffer.bytesRead;

      if (objectResult.isErr()) {
        yield objectResult;
        return;
      }

      this._progress.objectsParsed += 1;
      yield objectResult;
    }

    const checksumResult = await this.parseChecksum();
    this._progress.bytesRead = this.buffer.bytesRead;
    yield checksumResult;
  }

  private async parseHeader(): Promise<
    Result<PackfileHeader, PackfileParseError>
  > {
    if (!(await this.buffer.ensure(HEADER_LENGTH))) {
      return Result.err(
        new PackfileParseError({
          offset: this.buffer.bytesRead,
          code: "UNEXPECTED_EOF",
          message: "Unexpected EOF while reading packfile header",
          objectsParsed: 0,
        })
      );
    }

    const signature = this.buffer.consume(4);
    if (!this.arrayEquals(signature, PACK_SIGNATURE)) {
      return Result.err(
        new PackfileParseError({
          offset: 0,
          code: "INVALID_SIGNATURE",
          message: `Invalid packfile signature: expected "PACK", got "${new TextDecoder().decode(signature)}"`,
          objectsParsed: 0,
        })
      );
    }

    const versionBytes = this.buffer.consume(4);
    const version = this.readUint32BE(versionBytes);
    if (version !== 2 && version !== 3) {
      return Result.err(
        new PackfileParseError({
          offset: 4,
          code: "UNSUPPORTED_VERSION",
          message: `Unsupported packfile version: ${version}`,
          objectsParsed: 0,
        })
      );
    }

    const countBytes = this.buffer.consume(4);
    const objectCount = this.readUint32BE(countBytes);

    this._progress.bytesRead = this.buffer.bytesRead;

    return Result.ok({
      type: "header",
      version,
      objectCount,
    });
  }

  private async parseObject(): Promise<
    Result<PackfileObject, PackfileParseError>
  > {
    const objectOffset = this.buffer.bytesRead;

    const headerResult = await this.parseObjectHeader();
    if (headerResult.isErr()) return headerResult;

    const { objectType, size } = headerResult.value;

    let baseOffset: number | undefined;
    let baseHash: string | undefined;

    if (objectType === "ofs_delta") {
      const offsetResult = await this.parseOfsOffset(objectOffset);
      if (offsetResult.isErr()) return Result.err(offsetResult.error);
      baseOffset = offsetResult.value;
    } else if (objectType === "ref_delta") {
      const hashResult = await this.parseRefHash();
      if (hashResult.isErr()) return Result.err(hashResult.error);
      baseHash = hashResult.value;
    }

    const dataResult = await this.decompressObject(size);
    if (dataResult.isErr()) {
      return Result.err(
        new PackfileParseError({
          offset: objectOffset,
          code: "DECOMPRESSION_FAILED",
          message: dataResult.error.message,
          objectsParsed: this._progress.objectsParsed,
        })
      );
    }

    const data = dataResult.value;

    if (objectType === "ofs_delta" && baseOffset !== undefined) {
      return Result.ok({
        type: "object",
        objectType: "ofs_delta",
        data,
        size,
        offset: objectOffset,
        baseOffset,
      });
    }

    if (objectType === "ref_delta" && baseHash !== undefined) {
      return Result.ok({
        type: "object",
        objectType: "ref_delta",
        data,
        size,
        offset: objectOffset,
        baseHash,
      });
    }

    return Result.ok({
      type: "object",
      objectType: objectType as "commit" | "tree" | "blob" | "tag",
      data,
      size,
      offset: objectOffset,
    });
  }

  private async parseObjectHeader(): Promise<
    Result<
      { objectType: PackfileObject["objectType"]; size: number },
      PackfileParseError
    >
  > {
    const firstByte = await this.buffer.readByte();
    if (firstByte === undefined) {
      return Result.err(
        new PackfileParseError({
          offset: this.buffer.bytesRead,
          code: "UNEXPECTED_EOF",
          message: "Unexpected EOF while reading object header",
          objectsParsed: this._progress.objectsParsed,
        })
      );
    }

    // First byte: 1TTTSSSS where T=type (bits 4-6), S=size (bits 0-3), MSB=continue
    const typeNum = (firstByte >> 4) & 0x07;
    const objectType = OBJECT_TYPE_MAP[typeNum];
    if (!objectType) {
      return Result.err(
        new PackfileParseError({
          offset: this.buffer.bytesRead - 1,
          code: "INVALID_OBJECT_HEADER",
          message: `Invalid object type: ${typeNum}`,
          objectsParsed: this._progress.objectsParsed,
        })
      );
    }

    // Variable-length size: first 4 bits from byte 0, then 7 bits per continuation byte
    let size = firstByte & 0x0f; // bits 0-3
    let shift = 4;
    let currentByte = firstByte;

    // MSB=1 means more bytes follow
    while ((currentByte & 0x80) !== 0) {
      const nextByte = await this.buffer.readByte();
      if (nextByte === undefined) {
        return Result.err(
          new PackfileParseError({
            offset: this.buffer.bytesRead,
            code: "UNEXPECTED_EOF",
            message: "Unexpected EOF while reading object size",
            objectsParsed: this._progress.objectsParsed,
          })
        );
      }
      size |= (nextByte & 0x7f) << shift; // accumulate 7 bits at current shift position
      shift += 7; // next byte contributes 7 bits higher
      currentByte = nextByte;
    }

    return Result.ok({ objectType, size });
  }

  private async parseOfsOffset(
    currentOffset: number
  ): Promise<Result<number, PackfileParseError>> {
    const firstByte = await this.buffer.readByte();
    if (firstByte === undefined) {
      return Result.err(
        new PackfileParseError({
          offset: this.buffer.bytesRead,
          code: "UNEXPECTED_EOF",
          message: "Unexpected EOF while reading delta offset",
          objectsParsed: this._progress.objectsParsed,
        })
      );
    }

    // OFS_DELTA uses a variable-length encoding where each continuation byte
    // adds 2^7 + 2^14 + ... to account for the "wasted" zero value in each byte
    let offset = firstByte & 0x7f; // first byte contributes 7 bits directly
    let currentByte = firstByte;

    while ((currentByte & 0x80) !== 0) {
      const nextByte = await this.buffer.readByte();
      if (nextByte === undefined) {
        return Result.err(
          new PackfileParseError({
            offset: this.buffer.bytesRead,
            code: "UNEXPECTED_EOF",
            message: "Unexpected EOF while reading delta offset",
            objectsParsed: this._progress.objectsParsed,
          })
        );
      }
      // +1 before shift accounts for the fact that 0 is never encoded (saves space)
      offset = ((offset + 1) << 7) | (nextByte & 0x7f);
      currentByte = nextByte;
    }

    return Result.ok(currentOffset - offset); // offset is relative (backward) from current position
  }

  private async parseRefHash(): Promise<Result<string, PackfileParseError>> {
    if (!(await this.buffer.ensure(SHA1_LENGTH))) {
      return Result.err(
        new PackfileParseError({
          offset: this.buffer.bytesRead,
          code: "UNEXPECTED_EOF",
          message: "Unexpected EOF while reading ref delta hash",
          objectsParsed: this._progress.objectsParsed,
        })
      );
    }

    const hashBytes = this.buffer.consume(SHA1_LENGTH);
    return Result.ok(this.bytesToHex(hashBytes));
  }

  private async decompressObject(
    expectedSize: number
  ): Promise<Result<Uint8Array, Error>> {
    const maxAttempts = 100;
    let bufferSize = Math.max(expectedSize * 2, 256);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const hasMore = await this.buffer.ensure(bufferSize);

      const available = this.buffer.peek(bufferSize);
      if (available.length === 0) {
        return Result.err(new Error("No data available for decompression"));
      }

      try {
        // inflateSync with { info: true } returns { buffer, engine: { bytesWritten } }
        // see https://nodejs.org/api/zlib.html#class-options
        const result = inflateSync(available, { info: true }) as unknown as {
          buffer: Buffer;
          engine: { bytesWritten: number };
        };
        this.buffer.consume(result.engine.bytesWritten);
        return Result.ok(new Uint8Array(result.buffer));
      } catch (err) {
        // EOF and still failing - no point retrying
        if (!hasMore) {
          return Result.err(
            err instanceof Error ? err : new Error(String(err))
          );
        }
        bufferSize *= 2;
      }
    }

    return Result.err(
      new Error("Failed to decompress object after maximum attempts")
    );
  }

  private async parseChecksum(): Promise<
    Result<PackfileResult, PackfileParseError>
  > {
    if (!(await this.buffer.ensure(SHA1_LENGTH))) {
      return Result.err(
        new PackfileParseError({
          offset: this.buffer.bytesRead,
          code: "UNEXPECTED_EOF",
          message: "Unexpected EOF while reading checksum",
          objectsParsed: this._progress.objectsParsed,
        })
      );
    }

    const expectedChecksum = this.buffer.consume(SHA1_LENGTH);
    const checksumHex = this.bytesToHex(expectedChecksum);
    const computedHash = new Uint8Array(this.hash.digest());
    const valid = this.arrayEquals(expectedChecksum, computedHash);

    if (!valid) {
      return Result.err(
        new PackfileParseError({
          offset: this.buffer.bytesRead - SHA1_LENGTH,
          code: "CHECKSUM_MISMATCH",
          message: `Checksum mismatch: expected ${checksumHex}, got ${this.bytesToHex(computedHash)}`,
          objectsParsed: this._progress.objectsParsed,
        })
      );
    }

    return Result.ok({
      type: "result",
      checksum: checksumHex,
      valid,
    });
  }

  private arrayEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Reads 4 bytes as a big-endian unsigned 32-bit integer.
   *
   * Big-endian means most significant byte first (network byte order).
   * Git packfiles use big-endian for multi-byte integers.
   *
   * @example
   * bytes: [0x00, 0x01, 0x02, 0x03]
   * result: 0x00010203 = 66051
   *
   * Bit layout:
   * ```
   * bytes[0] << 24  →  0x00______ (bits 24-31)
   * bytes[1] << 16  →  0x__01____ (bits 16-23)
   * bytes[2] << 8   →  0x____02__ (bits 8-15)
   * bytes[3]        →  0x______03 (bits 0-7)
   *                    ──────────
   *               OR → 0x00010203
   * ```
   *
   * The `>>> 0` at the end converts the result to an unsigned 32-bit integer.
   * Without it, if the high bit is set (bytes[0] >= 0x80), JavaScript would
   * treat the result as a negative signed 32-bit integer.
   */
  private readUint32BE(bytes: Uint8Array): number {
    return (
      ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
    );
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
