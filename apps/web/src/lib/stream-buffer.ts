/**
 * Buffered reader for ReadableStream that provides exact byte count reads.
 *
 * Streams deliver arbitrary chunk sizes, but binary protocols need exact amounts:
 * "give me 4 bytes", "give me 20 bytes", etc. StreamBuffer bridges this gap.
 *
 * Features:
 * - `ensure(n)` - wait until n bytes available
 * - `peek(n)` / `consume(n)` - read exact byte counts across chunk boundaries
 * - Memory efficient - drops fully consumed chunks
 * - Optional `onData` callback for incremental processing (e.g., streaming hash)
 */
export class StreamBuffer {
  private readonly chunks: Uint8Array[] = [];
  private totalLength = 0;
  private position = 0;
  private absolutePosition = 0;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private done = false;
  private readonly onData: ((chunk: Uint8Array) => void) | null;

  constructor(
    source: ReadableStream<Uint8Array>,
    options?: { onData?: (chunk: Uint8Array) => void }
  ) {
    this.reader = source.getReader();
    this.onData = options?.onData ?? null;
  }

  /** Total bytes consumed so far (monotonically increasing) */
  get bytesRead(): number {
    return this.absolutePosition;
  }

  /**
   * Ensures at least `length` bytes are available in the buffer.
   * @returns false if EOF reached before enough bytes available
   */
  async ensure(length: number): Promise<boolean> {
    while (this.totalLength - this.position < length && !this.done) {
      const { value, done } = await this.reader.read();
      if (done) {
        this.done = true;
        break;
      }
      if (value && value.length > 0) {
        this.chunks.push(value);
        this.onData?.(value);
        this.totalLength += value.length;
      }
    }
    return this.totalLength - this.position >= length;
  }

  /**
   * Peeks at the next `length` bytes without consuming them.
   * Call `ensure(length)` first to guarantee bytes are available.
   */
  peek(length: number): Uint8Array {
    return this.readInternal(length, false);
  }

  /**
   * Reads and consumes `length` bytes from the buffer.
   * Call `ensure(length)` first to guarantee bytes are available.
   */
  consume(length: number): Uint8Array {
    return this.readInternal(length, true);
  }

  /**
   * Reads a single byte and advances position.
   * @returns undefined if EOF
   */
  async readByte(): Promise<number | undefined> {
    if (!(await this.ensure(1))) return undefined;
    return this.consume(1)[0];
  }

  private readInternal(length: number, advance: boolean): Uint8Array {
    const result = new Uint8Array(length);
    let resultOffset = 0;
    let remaining = length;
    let chunkIndex = 0;
    let localPosition = this.position;

    // Find starting chunk
    let chunkStart = 0;
    while (
      chunkIndex < this.chunks.length &&
      chunkStart + this.chunks[chunkIndex].length <= localPosition
    ) {
      chunkStart += this.chunks[chunkIndex].length;
      chunkIndex += 1;
    }

    // Read bytes across chunks
    while (remaining > 0 && chunkIndex < this.chunks.length) {
      const chunk = this.chunks[chunkIndex];
      const offsetInChunk = localPosition - chunkStart;
      const availableInChunk = chunk.length - offsetInChunk;
      const toCopy = Math.min(remaining, availableInChunk);

      result.set(
        chunk.subarray(offsetInChunk, offsetInChunk + toCopy),
        resultOffset
      );
      resultOffset += toCopy;
      remaining -= toCopy;
      localPosition += toCopy;

      if (offsetInChunk + toCopy >= chunk.length) {
        chunkStart += chunk.length;
        chunkIndex += 1;
      }
    }

    if (advance) {
      const bytesConsumed = localPosition - this.position;
      this.position = localPosition;
      this.absolutePosition += bytesConsumed;
      this.compactIfNeeded();
    }

    return result;
  }

  /** Remove fully consumed chunks to free memory */
  private compactIfNeeded(): void {
    let consumed = 0;
    let chunksToRemove = 0;

    for (const chunk of this.chunks) {
      if (consumed + chunk.length <= this.position) {
        consumed += chunk.length;
        chunksToRemove += 1;
      } else {
        break;
      }
    }

    if (chunksToRemove > 0) {
      this.chunks.splice(0, chunksToRemove);
      this.position -= consumed;
      this.totalLength -= consumed;
    }
  }
}
