export type FlushPkt = { type: "flush" };
export type DelimiterPkt = { type: "delim" };
export type ResponseEndPkt = { type: "response-end" };
export type DataPkt = { type: "data"; data: Uint8Array };
export type ErrorPkt = { type: "error"; message: string };

export type Packet =
  | FlushPkt
  | DelimiterPkt
  | ResponseEndPkt
  | DataPkt
  | ErrorPkt;

export class PktLine {
  static readonly FLUSH = "0000";
  static readonly DELIM = "0001";
  static readonly RESPONSE_END = "0002";

  static readonly MAX_PKT_SIZE = 65_520;
  /** Maximum payload size (MAX_PKT_SIZE - 4 byte header) */
  static readonly MAX_PAYLOAD_SIZE = 65_516;

  private static readonly ERR_PREFIX = "ERR ";

  static encode(data: Uint8Array | string): Uint8Array {
    const payload = typeof data === "string" ? PktLine.encodeText(data) : data;

    if (payload.length > PktLine.MAX_PAYLOAD_SIZE) {
      throw new Error(
        `Payload size ${payload.length} exceeds maximum ${PktLine.MAX_PAYLOAD_SIZE}`
      );
    }

    const len = payload.byteLength + 4; // length includes the 4-byte header
    const header = new TextEncoder().encode(PktLine.formatPktLength(len));
    const out = new Uint8Array(header.byteLength + payload.byteLength);
    out.set(header, 0);
    out.set(payload, header.byteLength);

    return out;
  }

  static encodeFlush(): Uint8Array {
    return PktLine.encodeText(PktLine.FLUSH);
  }

  static encodeDelim(): Uint8Array {
    return PktLine.encodeText(PktLine.DELIM);
  }

  static encodeResponseEnd(): Uint8Array {
    return PktLine.encodeText(PktLine.RESPONSE_END);
  }

  static decode(buffer: Uint8Array): Packet {
    if (buffer.length < 4) {
      throw new Error(
        `Buffer too short: ${buffer.length} bytes (need at least 4)`
      );
    }

    const lengthHex = PktLine.decodeText(buffer.slice(0, 4));

    if (lengthHex === PktLine.FLUSH) {
      return { type: "flush" };
    }
    if (lengthHex === PktLine.DELIM) {
      return { type: "delim" };
    }
    if (lengthHex === PktLine.RESPONSE_END) {
      return { type: "response-end" };
    }

    const length = PktLine.parsePktLength(buffer.slice(0, 4));

    if (buffer.length < length) {
      throw new Error(
        `Buffer too short: ${buffer.length} bytes (need ${length})`
      );
    }

    const data = buffer.slice(4, length);

    if (data.length >= 4) {
      const prefix = PktLine.decodeText(data.slice(0, 4));
      if (prefix === PktLine.ERR_PREFIX) {
        const message = PktLine.decodeText(data.slice(4));
        return { type: "error", message };
      }
    }

    return { type: "data", data };
  }

  static encodeText(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  static decodeText(data: Uint8Array): string {
    return new TextDecoder().decode(data);
  }

  static mergeLines(lines: Uint8Array[]): Uint8Array {
    const totalLength = lines.reduce((sum, line) => sum + line.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const line of lines) {
      merged.set(line, offset);
      offset += line.byteLength;
    }
    return merged;
  }

  private static parsePktLength(header: Uint8Array): number {
    if (header.length !== 4) {
      throw new Error(
        `Invalid length header: expected 4 bytes, got ${header.length}`
      );
    }

    const hex = PktLine.decodeText(header);
    const length = Number.parseInt(hex, 16);

    if (Number.isNaN(length)) {
      throw new Error(`Invalid hexadecimal length: ${hex}`);
    }

    if (length < 4) {
      throw new Error(`Invalid length: ${length} (must be at least 4)`);
    }

    if (length > PktLine.MAX_PKT_SIZE) {
      throw new Error(
        `Length ${length} exceeds maximum ${PktLine.MAX_PKT_SIZE}`
      );
    }

    return length;
  }

  private static formatPktLength(length: number): string {
    if (length < 0 || length > PktLine.MAX_PKT_SIZE) {
      throw new Error(
        `Invalid length: ${length} (must be 0-${PktLine.MAX_PKT_SIZE})`
      );
    }

    return length.toString(16).padStart(4, "0");
  }
}
