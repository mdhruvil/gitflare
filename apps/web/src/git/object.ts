/**
 * Git object hashing and framing.
 *
 * Git objects are stored with a header: "type size\0data"
 * The SHA-1 hash is computed over the entire wrapped object.
 *
 * @see https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
 */

import { createHash } from "node:crypto";
import { Result, TaggedError } from "better-result";

export type GitObjectType = "commit" | "tree" | "blob" | "tag";

export type ObjectErrorCode =
  | "INVALID_HEADER"
  | "INVALID_TYPE"
  | "SIZE_MISMATCH";

export class ObjectError extends TaggedError("ObjectError")<{
  code: ObjectErrorCode;
  message: string;
}>() {}

const VALID_TYPES = new Set<string>(["commit", "tree", "blob", "tag"]);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/**
 * Compute SHA-1 OID for a git object.
 * Hash is computed over: "type size\0" + data
 */
function computeOid(type: GitObjectType, data: Uint8Array): string {
  const wrapped = wrap(type, data);
  const hash = createHash("sha1");
  hash.update(wrapped);
  return hash.digest("hex");
}

/**
 * Wrap raw data with git object header.
 * Returns: "type size\0" + data as Uint8Array
 */
function wrap(type: GitObjectType, data: Uint8Array): Uint8Array {
  const header = TEXT_ENCODER.encode(`${type} ${data.length}\0`);
  const result = new Uint8Array(header.length + data.length);
  result.set(header, 0);
  result.set(data, header.length);
  return result;
}

/**
 * Unwrap a git object to extract type and data.
 * Parses: "type size\0data"
 */
function unwrap(
  wrapped: Uint8Array
): Result<{ type: GitObjectType; data: Uint8Array }, ObjectError> {
  const nullIndex = wrapped.indexOf(0);
  if (nullIndex === -1) {
    return Result.err(
      new ObjectError({
        code: "INVALID_HEADER",
        message: "Missing null byte in object header",
      })
    );
  }

  // Parse header: "type size"
  const headerBytes = wrapped.subarray(0, nullIndex);
  const header = TEXT_DECODER.decode(headerBytes);
  const spaceIndex = header.indexOf(" ");

  if (spaceIndex === -1) {
    return Result.err(
      new ObjectError({
        code: "INVALID_HEADER",
        message: "Missing space in object header",
      })
    );
  }

  const typeStr = header.slice(0, spaceIndex);
  const sizeStr = header.slice(spaceIndex + 1);

  if (!VALID_TYPES.has(typeStr)) {
    return Result.err(
      new ObjectError({
        code: "INVALID_TYPE",
        message: `Invalid object type: "${typeStr}"`,
      })
    );
  }
  const type = typeStr as GitObjectType;

  const size = Number.parseInt(sizeStr, 10);
  if (Number.isNaN(size) || size < 0) {
    return Result.err(
      new ObjectError({
        code: "INVALID_HEADER",
        message: `Invalid size in object header: "${sizeStr}"`,
      })
    );
  }

  const data = wrapped.subarray(nullIndex + 1);

  if (data.length !== size) {
    return Result.err(
      new ObjectError({
        code: "SIZE_MISMATCH",
        message: `Size mismatch: header says ${size}, actual data is ${data.length}`,
      })
    );
  }

  return Result.ok({ type, data });
}

export type CommitWalkData = {
  tree: string;
  parents: string[];
};

/**
 * Parse a commit object to extract tree and parent OIDs for graph traversal.
 * This is a minimal parser focused only on what's needed for commit graph caching.
 *
 * Commit format:
 * ```
 * tree <tree-oid>\n
 * parent <parent-oid>\n    (zero or more)
 * author ...\n
 * committer ...\n
 * \n
 * <message>
 * ```
 */
function parseCommitForWalk(
  data: Uint8Array
): Result<CommitWalkData, ObjectError> {
  const text = TEXT_DECODER.decode(data);
  const lines = text.split("\n");

  let tree: string | undefined;
  const parents: string[] = [];

  for (const line of lines) {
    // Empty line marks end of headers
    if (line === "") {
      break;
    }

    if (line.startsWith("tree ")) {
      tree = line.slice(5);
    } else if (line.startsWith("parent ")) {
      parents.push(line.slice(7));
    }
  }

  if (!tree) {
    return Result.err(
      new ObjectError({
        code: "INVALID_HEADER",
        message: "Commit missing tree field",
      })
    );
  }

  return Result.ok({ tree, parents });
}

export const GitObject = { computeOid, wrap, unwrap, parseCommitForWalk };
