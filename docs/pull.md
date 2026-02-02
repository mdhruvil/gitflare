# Plan: git-upload-pack (fetch/clone) Implementation

## Executive Summary

Implement streaming git-upload-pack to support `git fetch` and `git clone` operations using the hybrid storage model (R2 packfiles + SQLite metadata). The implementation will:

- Stream pack data directly from R2 to client (no full buffering)
- Use Result/TaggedError for all error handling
- Follow the clean architecture established in receive-pack
- **Protocol v2** (HTTP smart protocol) - command-based, stateless
- **Minimize subrequests** via commit graph cache and batch R2 reads

---

## Lessons Learned from receive-pack

| Mistake                                  | How to Avoid                                                  |
| ---------------------------------------- | ------------------------------------------------------------- |
| God class with too many responsibilities | Small, focused modules: protocol/, handlers/, do/             |
| Mixed concerns in single file            | Separate: parsing, traversal, pack-writing, orchestration     |
| Buffering entire packfile                | Stream chunks directly via TransformStream                    |
| Inconsistent error handling              | Result<T, TaggedError> everywhere, define error codes upfront |
| Missing type definitions                 | Define all types in dedicated files first                     |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     HTTP Layer (Protocol v2)                     │
│  GET  /info/refs?service=git-upload-pack  (capability discovery) │
│  POST /git-upload-pack  (commands: ls-refs, fetch)               │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   git/handlers/upload-pack.ts                    │
│  Orchestrates: parse request → traverse → generate pack         │
│  Detects fresh clone vs incremental fetch                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────────┐
│  protocol/  │  │   walker/   │  │   pack-writer/  │
│upload-pack.ts│ │object-walk.ts│ │  pack-stream.ts │
│ parse wants │  │  Uses commit │  │ streaming pack  │
│ parse haves │  │  graph cache │  │   generation    │
│ encode caps │  │  (SQLite)   │  │ batch R2 reads  │
└─────────────┘  └─────────────┘  └─────────────────┘
                         │               │
                         ▼               ▼
              ┌──────────────────────────────────────┐
              │         do/object-store.ts           │
              │  readBatch() - coalesced R2 reads    │
              │  getAllMetadata() - for fresh clone  │
              └──────────────────────────────────────┘
```

---

## Critical Optimization: Minimize Subrequests

### The Problem

Naive implementation for a 2,600 object repo:

- Walk: ~600 reads (commits + trees)
- Pack generation: ~2,600 reads
- **Total: ~3,200 SQLite queries + ~3,200 × Δ R2 requests**

### The Solution

| Scenario               | Naive           | Optimized                |
| ---------------------- | --------------- | ------------------------ |
| Fresh clone (2.6k obj) | ~6,000 requests | **1 SQLite + ~2 R2**     |
| Fetch 1 commit         | ~60 requests    | **~5 SQLite + ~3 R2**    |
| Fetch 100 commits      | ~7,000 requests | **~200 SQLite + ~20 R2** |

---

## Phase 0: Schema Changes (receive-pack modification) ✅ DONE

**IMPORTANT:** These changes must be made to receive-pack to populate caches during push.

### 0.1 Commit Graph Table

Add to schema and populate during pack indexing:

```sql
CREATE TABLE commit_graph (
  oid TEXT PRIMARY KEY,
  tree_oid TEXT NOT NULL,
  parent_oids TEXT NOT NULL  -- JSON array, e.g. '["abc123","def456"]' or '[]'
);
```

**Why:** Eliminates R2 reads during commit traversal. Walk uses SQLite only for commits.

**Why JSON array:** Enables recursive CTE with `json_each()` for efficient ancestor traversal in a single query.

### 0.2 Repo Stats in typedStorage

Use the existing `typedStorage` in HybridRepo DO instead of a separate table:

```typescript
// In hybrid-repo.ts typedStorage interface, add:
interface StorageSchema {
  // ... existing keys
  objectCount: number;
  lastPushAt: number; // timestamp
}

// Usage:
await this.typedStorage.put("objectCount", totalObjects);
const count = await this.typedStorage.get("objectCount");
```

**Why:** Instant object count for pack header without scanning. Uses existing typed storage pattern.

### 0.3 Modification to PackIndexer

During `processPackfile()`, after parsing each object:

```typescript
if (obj.type === "commit") {
  const parsed = parseCommitForWalk(obj.data);
  await db.insert(commitGraph).values({
    oid: obj.oid,
    treeOid: parsed.tree,
    parentOids: parsed.parents, // Drizzle handles JSON serialization with text({ mode: 'json' })
  });
}
```

**Schema definition with Drizzle:**

```typescript
// In do/schema/git.ts
export const commitGraph = sqliteTable("commit_graph", {
  oid: text("oid").primaryKey(),
  treeOid: text("tree_oid").notNull(),
  parentOids: text("parent_oids", { mode: "json" }).$type<string[]>().notNull(),
});
```

**Files to modify:**

- `do/schema/git.ts` - Add commit_graph table
- `do/pack-indexer.ts` - Populate commit_graph during indexing
- `do/hybrid-repo.ts` - Add objectCount/lastPushAt to typedStorage

---

## Phase 1: Types & Error Definitions ✅ DONE

**Reuse existing types and errors from `git/` directory. Only add new types if not already present.**

### Existing Types to Reuse

- `git/errors.ts` - Extend existing error types (ProtocolError, etc.)
- `git/object.ts` - GitObjectType
- `git/pkt.ts` - Packet line utilities

### New Types (add to `git/types.ts` if needed)

```typescript
// Object metadata for batch fetching (may already exist in object-store)
type ObjectMetadata = {
  oid: string;
  type: GitObjectType;
  packfileId: string;
  offset: number;
  size: number;
};
```

### Error Handling

Extend existing `ProtocolError` in `git/errors.ts` with new codes if needed:

```typescript
// Add to existing ProtocolErrorCode union
| "INVALID_WANT"      // Unknown OID in want
| "TRAVERSAL_ERROR"   // Walk failed
| "PACK_WRITE_ERROR"  // Pack generation failed
| "REPO_TOO_LARGE"    // Exceeds size limit
```

**Do NOT create upload-pack specific error classes. Reuse existing patterns.**

---

## Phase 2: Protocol Layer (v2) ✅ DONE

**File:** `git/protocol/upload-pack-v2.ts`

### 2.1 Protocol v2 Overview

Git protocol v2 is **command-based** and **stateless**. Key differences from v1:

| Aspect      | v1                          | v2                         |
| ----------- | --------------------------- | -------------------------- |
| Discovery   | Refs + caps in one response | Explicit `ls-refs` command |
| Negotiation | Interleaved want/have/ACK   | Single `fetch` command     |
| Sections    | Implicit                    | Explicit delimiters (0001) |
| Stateless   | No                          | Yes (all state in request) |

**Special packets:**

- `0000` = flush-pkt (end of section)
- `0001` = delim-pkt (section separator)
- `0002` = response-end-pkt (end of response)

### 2.2 Capability Advertisement (Info/Refs)

Client sends `Git-Protocol: version=2` header. Server responds with capabilities:

```typescript
// Server capabilities for v2
const V2_CAPABILITIES = [
  "version 2",
  "ls-refs", // Command: list references
  "fetch", // Command: fetch objects
  "server-option", // Allow client to send server-specific options
];

// Fetch command capabilities (sent with fetch command response)
const FETCH_CAPS = [
  "no-progress", // Client can suppress progress
  // Note: We do NOT advertise ofs-delta, shallow, include-tag, thin-pack for MVP
];

function advertiseV2Capabilities(): Uint8Array;
// Output format:
// PKT-LINE("version 2\n")
// PKT-LINE("ls-refs\n")
// PKT-LINE("fetch\n")
// PKT-LINE("server-option\n")
// flush-pkt (0000)
```

### 2.3 Command: ls-refs

Client requests refs with optional filtering:

**Request format:**

```
command=ls-refs
0001                          # delim-pkt
peel                          # (optional) Include peeled OIDs
symrefs                       # (optional) Include symref targets
ref-prefix refs/heads/        # (optional) Filter by prefix
ref-prefix refs/tags/
0000                          # flush-pkt
```

**Response format:**

```
<oid> SP <refname> [SP symref-target:<target>] [SP peeled:<oid>] LF
...
0000                          # flush-pkt
```

**Example:**

```
PKT-LINE("abc123 refs/heads/main symref-target:refs/heads/main\n")
PKT-LINE("def456 refs/heads/feature\n")
PKT-LINE("789abc refs/tags/v1.0 peeled:abc123\n")
flush-pkt
```

```typescript
type LsRefsRequest = {
  peel: boolean;
  symrefs: boolean;
  refPrefixes: string[];
};

function parseLsRefsRequest(
  stream: ReadableStream<Uint8Array>,
): Promise<Result<LsRefsRequest, ProtocolError>>;

function encodeLsRefsResponse(
  refs: Ref[],
  options: { peel: boolean; symrefs: boolean },
): Uint8Array;
```

### 2.4 Command: fetch

Client sends wants/haves in a single request:

**Request format:**

```
command=fetch
0001                          # delim-pkt
no-progress                   # (optional) Suppress progress
want <oid>                    # Objects client wants
want <oid>
have <oid>                    # Objects client has
have <oid>
done                          # Client ready for packfile (omit for negotiation-only)
0000                          # flush-pkt
```

**Note:** We do NOT support `thin-pack` or `ofs-delta` capabilities. All objects are sent as non-delta.

**Response format (with `done`):**

```
packfile                      # Section marker
0001                          # delim-pkt
[sideband-multiplexed data]   # Channel 1=pack, 2=progress, 3=error
0000                          # flush-pkt
```

**Response format (without `done` - negotiation only):**

```
acknowledgments               # Section marker
NAK                          # Or: ACK <oid>
0001                          # delim-pkt (if more sections)
0000                          # Or 0002 (response-end)
```

**Key rule:** If client sends `done`, skip `acknowledgments` section and go straight to `packfile`.

```typescript
type FetchRequest = {
  wants: string[];
  haves: string[];
  done: boolean;
  capabilities: {
    noProgress: boolean;
    // Note: thinPack, ofsDelta, includeTag not supported in MVP
  };
};

function parseFetchRequest(
  stream: ReadableStream<Uint8Array>,
): Promise<Result<FetchRequest, ProtocolError>>;
```

### 2.5 Response Encoding

```typescript
// Section markers
function encodeAcknowledgments(acks: string[], ready: boolean): Uint8Array;
// Output:
// PKT-LINE("acknowledgments\n")
// PKT-LINE("ACK <oid>\n") for each ack
// PKT-LINE("ready\n") if ready, else PKT-LINE("NAK\n")
// delim-pkt (0001) or flush-pkt (0000)

function encodePackfileSection(): Uint8Array;
// Output:
// PKT-LINE("packfile\n")
// [followed by sideband-multiplexed pack data]

// Sideband channels (same as v1)
// Channel 1: Pack data
// Channel 2: Progress messages
// Channel 3: Error messages
```

### 2.6 HTTP Headers

**Request:**

```
POST /$owner/$repo/git-upload-pack HTTP/1.1
Content-Type: application/x-git-upload-pack-request
Git-Protocol: version=2
```

**Response:**

```
HTTP/1.1 200 OK
Content-Type: application/x-git-upload-pack-result
```

---

## Phase 3: Object Traversal ✅ DONE

**File:** `git/upload-pack/object-walk.ts`

### 3.1 Fresh Clone Path (FAST)

**No graph walking needed!** Query all objects directly from SQLite.

```typescript
async function getAllObjectsForClone(
  db: DrizzleDB,
): Promise<Result<ObjectMetadata[], UploadPackError>>;

// Implementation:
// SELECT oid, type, packfile_id, offset, size FROM objects
// ORDER BY packfile_id, offset  -- Optimal for sequential R2 reads
```

**Subrequests: 1 SQLite query, 0 R2 reads for discovery**

### 3.2 Incremental Fetch Path

Uses commit_graph cache to avoid R2 reads for commits:

```typescript
type WalkResult = {
  objects: ObjectMetadata[]; // Already has packfile info for batching
  commits: number;
  trees: number;
  blobs: number;
};

async function walkObjectsIncremental(
  wants: string[],
  haves: string[],
  db: DrizzleDB,
  objects: ObjectStore,
  onProgress?: (count: number) => void,
): Promise<Result<WalkResult, UploadPackError>>;
```

**Algorithm:**

```
1. Mark haves as complete (SINGLE SQLite query using recursive CTE + json_each)

   WITH RECURSIVE ancestors(oid) AS (
     -- Base case: the haves themselves
     SELECT oid FROM commit_graph WHERE oid IN (?, ?, ...)
     UNION
     -- Recursive case: parents of ancestors (using json_each to expand JSON array)
     SELECT j.value
     FROM ancestors a
     JOIN commit_graph cg ON cg.oid = a.oid
     JOIN json_each(cg.parent_oids) j
   )
   SELECT oid FROM ancestors

2. Walk from wants (SINGLE SQLite query - same pattern)
   - Recursive CTE from wants, stopping when hitting complete set
   - Collect all commit OIDs and their tree_oids

3. For trees: query type from objects table (SQLite, no R2!)
   - Get subtree OIDs by reading tree content from R2 (batched by packfile)
   - Recursively expand subtrees

4. Collect blob OIDs from tree entries (no R2 read needed for blobs themselves)

5. Return ObjectMetadata with packfile info for batch fetching
```

**Key insight:** Object types are in SQLite `objects` table, so checking if an OID is a tree/blob/commit is a SQLite query, NOT an R2 read.

### 3.3 Ancestor Query (Single Recursive CTE)

```typescript
// Mark all ancestors of haves as complete - SINGLE QUERY
async function getAncestorClosure(
  db: DrizzleDB,
  roots: string[],
): Promise<Set<string>>;

// Implementation using raw SQL for recursive CTE with json_each:
const result = await db.run(sql`
  WITH RECURSIVE ancestors(oid) AS (
    SELECT oid FROM commit_graph WHERE oid IN ${roots}
    UNION
    SELECT j.value
    FROM ancestors a
    JOIN commit_graph cg ON cg.oid = a.oid
    JOIN json_each(cg.parent_oids) j
  )
  SELECT oid FROM ancestors
`);
return new Set(result.rows.map((r) => r.oid));
```

### 3.4 Walk From Wants (Single Recursive CTE)

```typescript
// Walk from wants, excluding complete set - returns commits + their trees
async function walkFromWants(
  db: DrizzleDB,
  wants: string[],
  complete: Set<string>,
): Promise<{ commits: string[]; trees: string[] }>;

// Implementation: CTE that stops when hitting complete set
// Returns commit OIDs and their tree_oids
```

### 3.5 Tree Parser (still needed for tree→blob discovery)

```typescript
type TreeEntry = {
  mode: string;
  name: string;
  oid: string;
};

function parseTreeEntries(data: Uint8Array): Result<TreeEntry[], ParseError>;
```

---

## Phase 4: Batch Object Reading ✅ DONE

**File:** `do/object-store.ts` (modifications)

### 4.1 New Methods

```typescript
// Get all object metadata (for fresh clone)
async getAllMetadata(): Promise<Result<ObjectMetadata[], ObjectStoreError>>

// Batch read with packfile-aware coalescing
async readBatch(
  oids: string[],
  onObject: (oid: string, type: GitObjectType, data: Uint8Array) => Promise<void>
): Promise<Result<void, ObjectStoreError>>
```

### 4.2 Batch Read Implementation

```typescript
async readBatch(oids, onObject) {
  // 1. Single SQLite query for all metadata
  const metadata = await this.getMetadataForOids(oids)

  // 2. Group by packfile, sort by offset
  const byPackfile = groupByPackfile(metadata)

  // 3. For each packfile, fetch spanning range
  for (const [packfileId, objects] of byPackfile) {
    const minOffset = Math.min(...objects.map(o => o.offset))
    const maxEnd = Math.max(...objects.map(o => o.offset + o.size))

    // Single R2 range request
    const data = await this.r2.get(packfileId, {
      range: { offset: minOffset, length: maxEnd - minOffset }
    })

    // Extract individual objects from fetched range
    for (const obj of objects) {
      const localOffset = obj.offset - minOffset
      const compressed = data.slice(localOffset, localOffset + obj.size)
      const decompressed = await this.decompress(compressed)
      const resolved = await this.resolveDelta(obj, decompressed)
      await onObject(obj.oid, resolved.type, resolved.data)
    }
  }
}
```

**Subrequests:** 1 SQLite + P R2 (where P = number of packfiles, usually 1-3)

---

## Phase 5: Streaming Pack Generation ✅ DONE

**File:** `git/upload-pack/pack-stream.ts`

### 5.1 Design Constraints (CF Workers)

- **128MB memory limit** → cannot buffer full pack
- **Must stream** → write header, then objects one-by-one
- **SHA1 checksum** → incremental hash as we write

### 5.2 Pack Format

```
PACK                    # 4 bytes magic "PACK"
version (2)             # 4 bytes big-endian
object count            # 4 bytes big-endian
[object entries...]     # Variable
SHA1 checksum           # 20 bytes trailer
```

### 5.3 Object Entry Format (non-delta)

```
[type+size header]      # Variable-length encoding
  - bits 4-6: type (1=commit, 2=tree, 3=blob, 4=tag)
  - bits 0-3: size bits 0-3
  - if MSB set: continue with more size bits
[zlib-compressed data]  # deflate(raw object data)
```

### 5.4 Streaming Writer

```typescript
class PackStreamWriter {
  private sha1: IncrementalSha1;
  private writer: WritableStreamDefaultWriter;
  private written: number = 0;

  constructor(writable: WritableStream<Uint8Array>, objectCount: number);

  async writeHeader(): Promise<Result<void, PackWriteError>>;

  async writeObject(
    type: GitObjectType,
    data: Uint8Array,
  ): Promise<Result<void, PackWriteError>>;

  async finalize(): Promise<Result<void, PackWriteError>>;
}
```

### 5.5 Incremental SHA1

```typescript
// Use node:crypto which supports .update() for incremental hashing
// CF Workers fully supports node:crypto
import { createHash } from "node:crypto";

class IncrementalSha1 {
  private hasher = createHash("sha1");

  update(chunk: Uint8Array): void {
    this.hasher.update(chunk);
  }

  digest(): Uint8Array {
    return new Uint8Array(this.hasher.digest());
  }
}
```

**Note:** This pattern is already used in `git/pack/index.ts` for packfile checksum validation.

---

## Phase 6: Handler Integration ✅ DONE

**File:** `git/handlers/upload-pack.ts`

### 6.1 Command Router

Protocol v2 requires routing based on command:

```typescript
async function handleUploadPackV2(
  ctx: {
    db: DrizzleDB;
    refs: RefStore;
    objects: ObjectStore;
  },
  request: Request,
): Promise<Result<Response, UploadPackError>> {
  // Parse the command from request body
  const command = yield * parseCommand(request.body);

  switch (command.type) {
    case "ls-refs":
      return handleLsRefs(ctx, command.args);
    case "fetch":
      return handleFetch(ctx, command.args);
    default:
      return Result.err(
        new UploadPackError({
          code: "PROTOCOL_ERROR",
          message: `Unknown command: ${command.type}`,
        }),
      );
  }
}
```

### 6.2 Handle ls-refs Command

```typescript
async function handleLsRefs(
  ctx: Context,
  args: LsRefsRequest,
): Promise<Result<Response, UploadPackError>> {
  const refs = await ctx.refs.list();

  // Filter by prefixes if specified
  let filtered = refs;
  if (args.refPrefixes.length > 0) {
    filtered = refs.filter((r) =>
      args.refPrefixes.some((p) => r.name.startsWith(p)),
    );
  }

  const response = encodeLsRefsResponse(filtered, {
    peel: args.peel,
    symrefs: args.symrefs,
  });

  return Result.ok(
    new Response(response, {
      headers: { "Content-Type": "application/x-git-upload-pack-result" },
    }),
  );
}
```

### 6.3 Handle fetch Command

```typescript
async function handleFetch(
  ctx: Context,
  req: FetchRequest,
): Promise<Result<Response, UploadPackError>> {
  // If no 'done', return acknowledgments only (negotiation phase)
  if (!req.done) {
    return handleFetchNegotiation(ctx, req);
  }

  // Client sent 'done' - skip acknowledgments, send packfile directly
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const progress = new ProgressReporter((p) => writeProgress(writer, p));

  ctx.waitUntil(
    (async () => {
      const result = await processFetchWithPack(ctx, req, writer, progress);
      if (result.isErr()) {
        await writeSidebandError(writer, result.error.message);
      }
      await writer.close();
    })(),
  );

  return Result.ok(
    new Response(readable, {
      headers: { "Content-Type": "application/x-git-upload-pack-result" },
    }),
  );
}

async function handleFetchNegotiation(
  ctx: Context,
  req: FetchRequest,
): Promise<Result<Response, UploadPackError>> {
  // Check which haves we have in common
  const validHaves = await filterExistingOids(ctx.objects, req.haves);

  const response = encodeAcknowledgments(
    validHaves,
    validHaves.length > 0, // ready if we have common objects
  );

  return Result.ok(
    new Response(response, {
      headers: { "Content-Type": "application/x-git-upload-pack-result" },
    }),
  );
}
```

### 6.4 Process Fetch with Packfile

```typescript
async function processFetchWithPack(
  ctx: Context,
  req: FetchRequest,
  writer: WritableStreamDefaultWriter,
  progress: ProgressReporter,
): Promise<Result<void, UploadPackError>> {
  return Result.gen(async function* () {
    // 1. Validate wants are advertised refs
    const refs = await ctx.refs.list();
    const advertisedOids = new Set(refs.map((r) => r.oid));
    for (const want of req.wants) {
      if (!advertisedOids.has(want)) {
        return Result.err(
          new UploadPackError({
            code: "INVALID_WANT",
            message: `Object ${want} was not advertised`,
          }),
        );
      }
    }

    // 2. Determine if fresh clone or incremental fetch
    const isFreshClone = req.haves.length === 0;

    let objectsToSend: ObjectMetadata[];

    if (isFreshClone) {
      // FAST PATH: No walking, just query all objects
      progress.report({ type: "counting", current: 0 });
      objectsToSend = yield* ctx.objects.getAllMetadata();
      progress.report({ type: "counting", current: objectsToSend.length });
    } else {
      // Incremental: Walk using commit_graph cache
      const walkResult = yield* walkObjectsIncremental(
        req.wants,
        req.haves,
        ctx.db,
        ctx.objects,
        (count) => progress.report({ type: "counting", current: count }),
      );
      objectsToSend = walkResult.objects;
    }

    // 3. Write packfile section header
    await writer.write(encodePackfileSection());

    // 4. Stream packfile with sideband multiplexing
    const packWriter = new PackStreamWriter(writer, objectsToSend.length);
    yield* packWriter.writeHeader();

    let written = 0;
    yield* ctx.objects.readBatch(
      objectsToSend.map((o) => o.oid),
      async (oid, type, data) => {
        await packWriter.writeObject(type, data);
        written++;
        if (!req.capabilities.noProgress) {
          progress.report({
            type: "writing",
            current: written,
            total: objectsToSend.length,
          });
        }
      },
    );

    yield* packWriter.finalize();

    // 5. Flush to end response
    await writer.write(FLUSH_PKT);

    return Result.ok(undefined);
  });
}
```

````

---

## Phase 7: DO Integration ✅ DONE

**File:** `do/hybrid-repo.ts` (modifications)

### 7.1 Protocol Version Detection

```typescript
// Check Git-Protocol header for version
private getProtocolVersion(request: Request): 1 | 2 {
  const proto = request.headers.get("Git-Protocol");
  if (proto?.includes("version=2")) return 2;
  return 1; // Fallback (but we only support v2)
}
````

### 7.2 New Route for git-upload-pack

```typescript
// In fetch() method switch
case "git-upload-pack":
  return this.routeUploadPackV2(request);

private async routeUploadPackV2(request: Request): Promise<Response> {
  const version = this.getProtocolVersion(request);
  if (version !== 2) {
    return new Response("Protocol version 2 required", { status: 400 });
  }

  const result = await handleUploadPackV2(
    {
      db: this.db,
      refs: this.refs,
      objects: this.objects,
    },
    request,
  );

  if (result.isErr()) {
    // Return error via sideband channel 3
    return new Response(encodeSidebandError(result.error.message), {
      status: 200, // Git expects 200 even for errors
      headers: {
        "Content-Type": "application/x-git-upload-pack-result",
      },
    });
  }

  return result.value;
}
```

### 7.3 Info/Refs for upload-pack (v2 capability advertisement)

```typescript
// In routeInfoRefs()
case "git-upload-pack":
  const version = this.getProtocolVersion(request);

  if (version === 2) {
    // v2: Return capability advertisement
    return new Response(advertiseV2Capabilities(), {
      headers: {
        "Content-Type": "application/x-git-upload-pack-advertisement",
        "Cache-Control": "no-cache",
      },
    });
  }

  // v1: Not supported
  return new Response("Protocol version 2 required", { status: 400 });
```

### 7.4 Response Format Summary

**GET /info/refs?service=git-upload-pack (v2):**

```
001e# service=git-upload-pack
0000
000bversion 2
000cls-refs
000bfetch
0014server-option
0000
```

**POST /git-upload-pack (ls-refs command):**

```
# Request:
0014command=ls-refs
0001
0009peel
000csymrefs
0000

# Response:
003f7c8a2b... refs/heads/main symref-target:HEAD
002a8d9e3f... refs/heads/feature
0000
```

**POST /git-upload-pack (fetch command with done):**

```
# Request:
0012command=fetch
0001
0032want 7c8a2b...
0032want 8d9e3f...
0032have abc123...
0009done
0000

# Response:
0010packfile
0001
[sideband-multiplexed pack data]
0000
```

---

## Phase 8: Route Handler ✅ DONE

**File:** `routes/$owner/$repo/git-upload-pack.ts`

```typescript
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { getRepoStub } from "@/lib/repo-stub";

export const Route = createAPIFileRoute("/$owner/$repo/git-upload-pack")({
  POST: async ({ request, params }) => {
    const stub = await getRepoStub(params.owner, params.repo);
    return stub.fetch(
      new Request("http://do/git-upload-pack", {
        method: "POST",
        body: request.body,
        headers: request.headers,
        duplex: "half",
      }),
    );
  },
});
```



## File Structure (Final)

```
apps/web/src/
├── do/
│   ├── schema/git.ts          # Add commit_graph table
│   ├── pack-indexer.ts        # Populate commit_graph during push
│   ├── object-store.ts        # Add getAllMetadata(), readBatch()
│   └── hybrid-repo.ts         # Add routeUploadPackV2, typedStorage keys
├── git/
│   ├── errors.ts              # Extend with new error codes (INVALID_WANT, etc.)
│   ├── upload-pack/
│   │   ├── object-walk.ts     # getAllObjectsForClone, walkObjectsIncremental
│   │   └── pack-stream.ts     # PackStreamWriter (uses node:crypto for SHA1)
│   ├── protocol/
│   │   └── upload-pack-v2.ts  # v2 command parsing & response encoding
│   │       # - advertiseV2Capabilities()
│   │       # - parseLsRefsRequest() / encodeLsRefsResponse()
│   │       # - parseFetchRequest() / encodePackfileSection()
│   │       # - encodeAcknowledgments()
│   ├── parsers/
│   │   └── tree.ts            # parseTreeEntries (reusable)
│   └── handlers/
│       └── upload-pack.ts     # handleUploadPackV2, handleLsRefs, handleFetch
└── routes/$owner/$repo/
    └── git-upload-pack.ts     # Forward to DO
```

---

## Subrequest Summary

| Scenario          | SQLite Queries | R2 Requests   | Notes                                       |
| ----------------- | -------------- | ------------- | ------------------------------------------- |
| Fresh clone       | 1              | P (packfiles) | No graph walk, just `SELECT * FROM objects` |
| Fetch 1 commit    | 3-4            | ~2            | 2 recursive CTEs + tree expansion           |
| Fetch 100 commits | 3-5            | ~5-10         | Same CTEs, more trees to expand             |

**SQLite breakdown for incremental fetch:**

1. Recursive CTE: ancestor closure from haves (1 query)
2. Recursive CTE: walk from wants (1 query)
3. Get tree OIDs' packfile metadata (1 query)
4. Get all objects' metadata for pack (1 query)

**R2 breakdown:**

- Only tree content reads (to discover blob OIDs)
- Batched by packfile with range coalescing

Where P = number of packfiles (typically 1-3 after periodic repacking)

---

## Deferred (Not MVP)

| Feature                | Why Defer                                |
| ---------------------- | ---------------------------------------- |
| Delta compression      | Adds complexity; non-delta works for MVP |
| Thin packs             | Requires tracking client's objects       |
| Shallow clones         | Niche use case; requires depth tracking  |
| Filter (partial clone) | Complex; requires blob filtering         |
| include-tag            | Client can fetch tags explicitly         |
| Protocol v1            | Deprecated; v2 is simpler and stateless  |

**Note:** We do not support `ofs-delta` capability. All pack objects are sent as non-delta.

---

## Risks & Mitigations

| Risk                                      | Impact | Mitigation                                            |
| ----------------------------------------- | ------ | ----------------------------------------------------- |
| Large repos (>50k objects) exceed 30s CPU | High   | Hard limit with clear error; chunked generation in v2 |
| Tree parsing still needs R2               | Medium | Acceptable; trees are fewer than blobs                |
| Delta chain resolution during batch read  | Medium | Coalesce delta chains in same R2 request              |

---

## Resolved Questions

| Question           | Decision                                              | Rationale                                                     |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------- |
| Walk memory        | Hybrid: in-memory up to 50k, SQLite temp table beyond | Most repos < 50k                                              |
| Compressed caching | Skip                                                  | Objects already compressed; re-compression needed anyway      |
| Negotiation        | Single-round with `done`                              | v2 allows client to send `done` immediately; skip multi-round |
| include-tag        | Skip                                                  | Client can `git fetch --tags`                                 |
| Request timeout    | Hard limit 50k objects for MVP                        | Chunked generation deferred                                   |
| Protocol version   | v2 only                                               | Simpler, stateless, command-based                             |

---

## Open Questions

1. **Periodic repacking** - Should we consolidate multiple packfiles into one? (Reduces R2 requests further)
2. **Delta chain depth limit** - Current limit is 50; is this sufficient?
3. **Progress throttling** - 100ms interval sufficient for large fetches?
