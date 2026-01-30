/**
 * Git delta application.
 *
 * Delta format (REF_DELTA):
 * - Varint: base object size
 * - Varint: result object size
 * - Instructions: sequence of copy/insert operations
 *
 * Copy instruction (MSB set):
 *   1oooosss [offset bytes] [size bytes]
 *   - o bits: which offset bytes follow (1-4)
 *   - s bits: which size bytes follow (1-3)
 *
 * Insert instruction (MSB clear):
 *   0sssssss [data bytes]
 *   - s bits: number of literal bytes to insert (1-127)
 *
 * @see https://git-scm.com/docs/pack-format#_deltified_representation
 */

import { Result, TaggedError } from "better-result";

type DeltaHeader = {
  baseSize: number;
  resultSize: number;
  headerLength: number;
};

export type DeltaErrorCode =
  | "INVALID_HEADER"
  | "BASE_SIZE_MISMATCH"
  | "RESULT_SIZE_MISMATCH"
  | "INVALID_OPCODE"
  | "COPY_OUT_OF_BOUNDS";

export class DeltaError extends TaggedError("DeltaError")<{
  code: DeltaErrorCode;
  message: string;
}>() {}

/**
 * Parse a varint from buffer at given offset.
 * Returns [value, bytesConsumed].
 *
 * Varint encoding: 7 bits per byte, MSB indicates continuation.
 */
function parseVarint(
  data: Uint8Array,
  offset: number
): Result<[number, number], DeltaError> {
  let value = 0;
  let shift = 0;
  let bytesConsumed = 0;

  while (offset + bytesConsumed < data.length) {
    const byte = data[offset + bytesConsumed];
    value |= (byte & 0x7f) << shift;
    bytesConsumed += 1;
    if ((byte & 0x80) === 0) {
      return Result.ok([value, bytesConsumed]);
    }
    shift += 7;
  }

  return Result.err(
    new DeltaError({
      code: "INVALID_HEADER",
      message: "Unexpected end of data while parsing varint",
    })
  );
}

function parseDeltaHeader(delta: Uint8Array): Result<DeltaHeader, DeltaError> {
  return Result.gen(function* () {
    const [baseSize, baseSizeLen] = yield* parseVarint(delta, 0);
    const [resultSize, resultSizeLen] = yield* parseVarint(delta, baseSizeLen);

    return Result.ok({
      baseSize,
      resultSize,
      headerLength: baseSizeLen + resultSizeLen,
    });
  });
}

function apply(
  base: Uint8Array,
  delta: Uint8Array
): Result<Uint8Array, DeltaError> {
  const headerResult = parseDeltaHeader(delta);
  if (headerResult.isErr()) return headerResult;

  const { baseSize, resultSize, headerLength } = headerResult.value;

  if (base.length !== baseSize) {
    return Result.err(
      new DeltaError({
        code: "BASE_SIZE_MISMATCH",
        message: `Base size mismatch: expected ${baseSize}, got ${base.length}`,
      })
    );
  }

  const result = new Uint8Array(resultSize);
  let resultOffset = 0;
  let deltaOffset = headerLength;

  while (deltaOffset < delta.length) {
    const opcode = delta[deltaOffset];
    deltaOffset += 1;

    if (opcode === 0) {
      return Result.err(
        new DeltaError({
          code: "INVALID_OPCODE",
          message: `Invalid opcode 0 at offset ${deltaOffset - 1}`,
        })
      );
    }

    if ((opcode & 0x80) !== 0) {
      // COPY instruction: copy from base
      // Bits 0-3: which offset bytes are present
      // Bits 4-6: which size bytes are present
      let copyOffset = 0;
      let copySize = 0;

      // Read offset bytes (little-endian)
      if ((opcode & 0x01) !== 0) {
        copyOffset |= delta[deltaOffset] << 0;
        deltaOffset += 1;
      }
      if ((opcode & 0x02) !== 0) {
        copyOffset |= delta[deltaOffset] << 8;
        deltaOffset += 1;
      }
      if ((opcode & 0x04) !== 0) {
        copyOffset |= delta[deltaOffset] << 16;
        deltaOffset += 1;
      }
      if ((opcode & 0x08) !== 0) {
        copyOffset |= delta[deltaOffset] << 24;
        deltaOffset += 1;
      }

      // Read size bytes (little-endian)
      if ((opcode & 0x10) !== 0) {
        copySize |= delta[deltaOffset] << 0;
        deltaOffset += 1;
      }
      if ((opcode & 0x20) !== 0) {
        copySize |= delta[deltaOffset] << 8;
        deltaOffset += 1;
      }
      if ((opcode & 0x40) !== 0) {
        copySize |= delta[deltaOffset] << 16;
        deltaOffset += 1;
      }

      // Size of 0 means 0x10000
      if (copySize === 0) {
        copySize = 0x1_00_00;
      }

      // Validate bounds
      if (copyOffset + copySize > base.length) {
        return Result.err(
          new DeltaError({
            code: "COPY_OUT_OF_BOUNDS",
            message: `Copy out of bounds: offset=${copyOffset}, size=${copySize}, base.length=${base.length}`,
          })
        );
      }

      // Copy from base to result
      result.set(
        base.subarray(copyOffset, copyOffset + copySize),
        resultOffset
      );
      resultOffset += copySize;
    } else {
      // INSERT instruction: copy literal bytes from delta
      const insertSize = opcode; // opcode itself is the size (1-127)

      result.set(
        delta.subarray(deltaOffset, deltaOffset + insertSize),
        resultOffset
      );
      deltaOffset += insertSize;
      resultOffset += insertSize;
    }
  }

  // Validate result size
  if (resultOffset !== resultSize) {
    return Result.err(
      new DeltaError({
        code: "RESULT_SIZE_MISMATCH",
        message: `Result size mismatch: expected ${resultSize}, produced ${resultOffset}`,
      })
    );
  }

  return Result.ok(result);
}

export const Delta = { apply };
