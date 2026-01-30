import type { ProgressEvent } from "@/do/pack-indexer";
import { PktLine } from "./pkt";

/**
 * Git sideband protocol writer.
 * Handles multiplexed output for packfile data, progress messages, and errors.
 *
 * When enabled, wraps all output in sideband-64k format (channel byte + pkt-line).
 * When disabled, passes data through unchanged (for clients without sideband support).
 */
export class SidebandWriter {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly enabled: boolean;

  constructor(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    enabled: boolean
  ) {
    this.writer = writer;
    this.enabled = enabled;
  }

  async writeData(data: Uint8Array): Promise<void> {
    if (this.enabled) {
      await this.writer.write(
        PktLine.encodeSideband(PktLine.SIDEBAND_CHANNEL_PACKFILE, data)
      );
    } else {
      await this.writer.write(data);
    }
  }

  async writeProgress(msg: string): Promise<void> {
    if (this.enabled) {
      await this.writer.write(PktLine.encodeProgress(msg));
    }
  }

  async writeError(msg: string): Promise<void> {
    if (this.enabled) {
      await this.writer.write(PktLine.encodeSidebandError(msg));
    }
  }

  async flush(): Promise<void> {
    if (this.enabled) {
      await this.writeData(PktLine.encodeFlush());
    }
    await this.writer.write(PktLine.encodeFlush());
  }

  async close(): Promise<void> {
    await this.writer.close();
  }
}

/**
 * Progress reporter with throttling.
 * Prevents excessive writes during long operations by enforcing minimum intervals.
 */
export class ProgressReporter {
  private readonly writer: SidebandWriter;
  private readonly throttleMs: number;
  private lastUpdate = 0;

  constructor(writer: SidebandWriter, throttleMs = 100) {
    this.writer = writer;
    this.throttleMs = throttleMs;
  }

  async report(event: ProgressEvent): Promise<void> {
    const now = Date.now();

    if (event.type === "writing_index") {
      await this.writer.writeProgress(
        `Writing index: ${event.count} objects, done.\n`
      );
      return;
    }

    const { current, total } = event;
    const isComplete = current === total;
    const shouldUpdate = isComplete || now - this.lastUpdate >= this.throttleMs;

    if (!shouldUpdate) return;

    this.lastUpdate = now;
    const pct = total === 0 ? 100 : Math.floor((current / total) * 100);
    const suffix = isComplete ? ", done.\n" : "\r";
    const phase =
      event.type === "unpacking" ? "Unpacking objects" : "Resolving deltas";

    await this.writer.writeProgress(
      `${phase}: ${pct.toString().padStart(3)}% (${current}/${total})${suffix}`
    );
  }
}
