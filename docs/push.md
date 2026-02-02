# Receive-Pack (Push) Implementation Plan

## Overview

When a client pushes to gitflare, we need to:

1. Stream the packfile to R2
2. Parse the packfile to extract objects
3. Compute OIDs for all objects (requires delta resolution)
4. Build object index in SQLite
5. Update refs in SQLite
6. Return status to client (with sideband progress messages)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Receive-Pack Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Client                                                                    │
│     │                                                                       │
│     │  POST /git-receive-pack                                               │
│     │  Body: [commands] + [packfile]                                        │
│     ▼                                                                       │
│   ┌─────────────────┐                                                       │
│   │  Parse Request  │  Extract ref update commands + packfile stream        │
│   └────────┬────────┘                                                       │
│            │                                                                │
│            ▼                                                                │
│   ┌─────────────────┐     ┌─────────────────┐                               │
│   │   Tee Stream    │────▶│   R2 Upload     │  Stream packfile to R2        │
│   └────────┬────────┘     └─────────────────┘                               │
│            │                                                                │
│            ▼                                                                │
│   ┌─────────────────┐                                                       │
│   │  Pack Parser    │  Existing streaming parser                            │
│   │  (src/git/pack) │  Emits: header, objects, checksum                     │
│   └────────┬────────┘                                                       │
│            │                                                                │
│            ▼                                                                │
│   ┌─────────────────┐     ┌─────────────────┐                               │
│   │  Pack Indexer   │────▶│  Delta Resolver │  For delta objects            │
│   │                 │     │  (in-memory)    │                               │
│   │  Computes OIDs  │     └─────────────────┘                               │
│   │  Builds index   │                                                       │
│   └────────┬────────┘                                                       │
│            │                                                                │
│            ▼                                                                │
│   ┌─────────────────┐                                                       │
│   │  SQLite Writes  │  1. Insert into git_packs                             │
│   │                 │  2. Batch insert into git_object_index                │
│   │                 │  3. Update git_refs                                   │
│   └────────┬────────┘                                                       │
│            │                                                                │
│            ▼                                                                │
│   ┌─────────────────┐                                                       │
│   │  Report Status  │  Sideband progress + ref update results               │
│   └─────────────────┘                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/git/
├── delta.ts              # DONE: Delta application (pure)
├── object.ts             # DONE: OID computation, wrap/unwrap (pure)
├── pack/
│   ├── index.ts          # EXISTS: Streaming parser (consider rename to parser.ts)
│   ├── types.ts          # EXISTS
│   └── error.ts          # EXISTS
├── pkt.ts                # EXISTS: Packet-line encoding (has sideband support)
└── protocol.ts           # EXISTS: Protocol helpers

src/do/
├── hybrid-repo.ts        # EXISTS: Wire up new components
├── pack-indexer.ts       # NEW: Index packs, compute OIDs
├── ref-store.ts          # DONE: Ref CRUD in SQLite
├── object-store.ts       # DONE: Read objects (needed for thin packs)
├── r2.ts                 # EXISTS
├── cache.ts              # EXISTS
└── schema/
    └── git.ts            # EXISTS
```

## Sideband Progress Messages (GitHub-style)

During push, GitHub sends **real-time streaming progress** via sideband channel 2. The client sees progress updates as each object is processed, not just final counts at the end.

### GitHub Push Output Example

```
Enumerating objects: 5, done.
Counting objects: 100% (5/5), done.
Delta compression using up to 8 threads
Compressing objects: 100% (3/3), done.
Writing objects: 100% (3/3), 1.23 KiB | 1.23 MiB/s, done.
Total 3 (delta 2), reused 0 (delta 0), pack-reused 0
remote: Resolving deltas:   0% (0/2)
remote: Resolving deltas:  50% (1/2)
remote: Resolving deltas: 100% (2/2), completed with 1 local object.
remote: Processing changes: refs: 1, done.
To github.com:user/repo.git
   abc1234..def5678  main -> main
```

**Key observation**: The `remote:` lines update in-place using `\r` (carriage return) until completion, then use `\n`.

### Static vs Streaming Progress

| Approach      | Behavior                   | User Experience                          |
| ------------- | -------------------------- | ---------------------------------------- |
| **Static**    | Send all counts at end     | User sees nothing, then suddenly "done"  |
| **Streaming** | Send updates as processing | User sees real-time 0%→50%→100% progress |

**We want streaming.**

### Sideband Protocol

```typescript
// Channel 1: Pack data (not used in receive-pack response)
// Channel 2: Progress messages (what we use)
// Channel 3: Error messages

// PktLine already has helpers:
PktLine.encodeProgress(message: string)      // Channel 2
PktLine.encodeSidebandError(message: string) // Channel 3
```

### Progress Message Format

```typescript
// In-progress update (overwrites previous line with \r):
`remote: Resolving deltas:  50% (1/2)\r`
// Final message (newline, moves to next line):
`remote: Resolving deltas: 100% (2/2), done.\n`;
```

### Streaming Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Streaming Response Architecture                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Client                              Server                                │
│     │                                   │                                   │
│     │◀──────────────────────────────────│ HTTP Response starts              │
│     │                                   │ (chunked transfer encoding)       │
│     │                                   │                                   │
│     │◀── sideband(2, "remote: ...")  ───│ Progress: object 1/100           │
│     │◀── sideband(2, "remote: ...")  ───│ Progress: object 2/100           │
│     │◀── sideband(2, "remote: ...")  ───│ Progress: object 3/100           │
│     │         ... time passes ...       │                                   │
│     │◀── sideband(2, "remote: ...")  ───│ Progress: 100/100, done           │
│     │◀── sideband(2, "remote: ...")  ───│ Progress: deltas 1/5             │
│     │         ... time passes ...       │                                   │
│     │◀── sideband(2, "remote: ...")  ───│ Progress: deltas 5/5, done       │
│     │◀── sideband(2, "remote: ...")  ───│ Progress: refs done              │
│     │◀── pkt-line("unpack ok\n")     ───│ Final status                     │
│     │◀── pkt-line("ok refs/heads/main") │                                   │
│     │◀── flush (0000)                ───│ End of response                   │
│     │                                   │                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation: TransformStream

```typescript
async function receivePack(
  packStream: ReadableStream<Uint8Array>,
  commands: RefUpdate[],
): Promise<Response> {
  // Create a streaming response
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  // Process in background, writing progress as we go
  const processPromise = (async () => {
    try {
      // Each writer.write() sends data to client immediately
      await writer.write(
        PktLine.encodeProgress("remote: Unpacking objects:   0% (0/10)\r"),
      );
      // ... process object 1 ...
      await writer.write(
        PktLine.encodeProgress("remote: Unpacking objects:  10% (1/10)\r"),
      );
      // ... etc ...
    } finally {
      await writer.close();
    }
  })();

  // Don't await - let it run while response streams
  ctx.waitUntil(processPromise);

  return new Response(readable, {
    headers: { "Content-Type": "application/x-git-receive-pack-result" },
  });
}
```

### Progress Callback in PackIndexer

The PackIndexer emits progress events that the caller converts to sideband messages:

```typescript
type ProgressEvent =
  | { phase: "unpacking"; current: number; total: number }
  | { phase: "resolving"; current: number; total: number }
  | { phase: "writing" };

interface PackIndexer {
  index(
    packId: string,
    r2Key: string,
    packStream: ReadableStream<Uint8Array>,
    onProgress?: (event: ProgressEvent) => Promise<void>, // async for backpressure
  ): Promise<Result<IndexResult, PackIndexError>>;
}
```

### Throttling Progress Updates

Don't send a message for every single object - throttle to avoid overhead:

```typescript
function createProgressThrottler(
  writer: WritableStreamDefaultWriter<Uint8Array>,
) {
  let lastUpdate = 0;
  const MIN_INTERVAL_MS = 100; // Max 10 updates/second

  return async (phase: string, current: number, total: number) => {
    const now = Date.now();
    const isComplete = current === total;
    const shouldUpdate = isComplete || now - lastUpdate >= MIN_INTERVAL_MS;

    if (!shouldUpdate) return;

    lastUpdate = now;
    const pct = Math.floor((current / total) * 100);
    const suffix = isComplete ? ", done.\n" : "\r";

    await writer.write(
      PktLine.encodeProgress(
        `remote: ${phase}: ${pct}% (${current}/${total})${suffix}`,
      ),
    );
  };
}
```

## Changes to Existing Code

This section lists modifications needed to already-implemented files.

### `src/git/protocol.ts` - MODIFY

Current `buildReportStatus()` returns a static `Response`. For streaming, we need a different approach:

**Option A**: Keep `buildReportStatus()` for final status only, streaming happens in DO

```typescript
// Current signature (keep as-is for final status)
export async function buildReportStatus(
  results: RefUpdateResult[],
  unpackOk: boolean,
): Promise<Response>;

// Add new helper for streaming status lines (not full Response)
export function encodeReportStatusLines(
  results: RefUpdateResult[],
  unpackOk: boolean,
): Uint8Array[] {
  const lines: Uint8Array[] = [];

  if (unpackOk) {
    lines.push(PktLine.encode("unpack ok\n"));
  } else {
    const error = results.find((r) => r.ref === "*")?.error ?? "unknown error";
    lines.push(PktLine.encode(`unpack ${error}\n`));
  }

  for (const result of results) {
    if (result.ref === "*") continue;
    if (result.ok) {
      lines.push(PktLine.encode(`ok ${result.ref}\n`));
    } else {
      lines.push(PktLine.encode(`ng ${result.ref} ${result.error}\n`));
    }
  }

  lines.push(PktLine.encodeFlush());
  return lines;
}
```

### `src/do/hybrid-repo.ts` - MODIFY

Current skeleton needs full `receivePack()` implementation with streaming response.

**Changes needed:**

1. Add `PackIndexer` dependency
2. Add `RefStore` dependency
3. Add `ObjectStore` dependency (for thin packs)
4. Implement `receivePack()` with `TransformStream`
5. Wire up progress callbacks

### `src/routes/$owner/$repo/git-receive-pack.ts` - MODIFY

Current route handler calls the old `Repo` DO. Need to:

1. Switch to `HybridRepo` DO (or add feature flag)
2. Pass the packfile as a stream (not buffered `Uint8Array`)
3. Return streaming response from DO

**Current code issue:**

```typescript
// Current: buffers entire request
const data = new Uint8Array(await request.arrayBuffer());
```

**Needed:**

```typescript
// Stream the request body directly
const packStream = request.body; // ReadableStream
```

### `src/git/pack/index.ts` - NO CHANGES

Parser already supports streaming via `AsyncIterable`. No changes needed.

### `src/do/object-store.ts` - NO CHANGES

Already implemented with delta resolution. Will be used by pack-indexer for thin packs.

### `src/do/ref-store.ts` - NO CHANGES

Already implemented. Will be used by `receivePack()`.

---

## Implementation Order

### Phase 1: Pure Git Primitives ✅

No storage dependencies. Fully testable with unit tests.

#### 1.1 `src/git/delta.ts` ✅

Delta application for REF_DELTA objects. **DONE**

- Varint parsing ✅
- Delta header parsing ✅
- Copy/insert instruction parsing ✅
- `Delta.apply()` function ✅

#### 1.2 `src/git/object.ts` ✅

Git object hashing and framing. **DONE**

- `GitObject.computeOid()` ✅
- `GitObject.wrap()` ✅
- `GitObject.unwrap()` ✅

### Phase 2: Storage Layer

#### 2.1 `src/do/ref-store.ts` ✅

Simple CRUD for refs in SQLite. **DONE**

- `get()` ✅
- `list()` ✅
- `resolve()` with symbolic ref support ✅
- `applyUpdates()` with atomic transactions ✅
- `setSymbolic()` ✅

#### 2.2 `src/do/object-store.ts` ✅

Read objects from storage. **DONE**

- `has()` ✅
- `read()` with recursive CTE for delta chains ✅
- Coalesced R2 range requests ✅
- Delta resolution ✅

#### 2.3 `src/do/pack-indexer.ts` ✅

The core of receive-pack. Indexes a packfile and stores metadata in SQLite. **DONE**

```typescript
import { Result, TaggedError } from "better-result";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { PackfileParser } from "@/git/pack";
import { Delta } from "@/git/delta";
import { GitObject, type GitObjectType } from "@/git/object";
import type { ObjectStore } from "./object-store";

// ─── Types ───────────────────────────────────────────────────────────────────

type IndexedObject = {
  oid: string;
  type: GitObjectType;
  offset: number;
  compressedSize: number;
  isDelta: boolean;
  baseOid?: string;
};

type IndexResult = {
  packId: string;
  objectCount: number;
  deltaCount: number;
  objects: IndexedObject[];
};

// ─── Errors ──────────────────────────────────────────────────────────────────

export class PackIndexError extends TaggedError("PackIndexError")<{
  code:
    | "PARSE_ERROR"
    | "DELTA_BASE_NOT_FOUND"
    | "DELTA_APPLY_ERROR"
    | "OFS_DELTA_NOT_SUPPORTED"
    | "DB_ERROR"
    | "CHECKSUM_MISMATCH";
  message: string;
  offset?: number;
}>() {}

// ─── Public API ──────────────────────────────────────────────────────────────

type PackIndexerDeps = {
  db: DB;
  existingObjects: ObjectStore; // For thin pack support
};

interface PackIndexer {
  /**
   * Index a packfile stream.
   * Yields progress events during indexing.
   */
  index(
    packId: string,
    r2Key: string,
    packStream: ReadableStream<Uint8Array>,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Result<IndexResult, PackIndexError>>;
}

type ProgressEvent =
  | { type: "unpacking"; current: number; total: number }
  | { type: "resolving_deltas"; current: number; total: number }
  | { type: "writing_index"; count: number };
```

**index() implementation:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Pack Indexing Algorithm                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Memory structures:                                                        │
│   - resolvedObjects: Map<oid, { type, data }>  (for computing deltas)       │
│   - pendingDeltas: Array<{ offset, baseHash, deltaData, compressedSize }>   │
│   - indexEntries: Array<IndexedObject>                                      │
│                                                                             │
│   Pass 1: Parse all objects                                                 │
│   ─────────────────────────                                                 │
│   for each object from parser:                                              │
│     onProgress({ type: 'unpacking', current, total })                       │
│                                                                             │
│     if base object (commit/tree/blob/tag):                                  │
│       oid = computeOid(type, data)                                          │
│       resolvedObjects.set(oid, { type, data })                              │
│       indexEntries.push({ oid, type, offset, compressedSize, isDelta:false })│
│                                                                             │
│     if ref_delta:                                                           │
│       pendingDeltas.push({ offset, baseHash, deltaData, compressedSize })   │
│                                                                             │
│     if ofs_delta:                                                           │
│       return Error("OFS_DELTA_NOT_SUPPORTED")                               │
│                                                                             │
│   Pass 2: Resolve deltas                                                    │
│   ──────────────────────                                                    │
│   resolvedCount = 0                                                         │
│   while pendingDeltas.length > 0:                                           │
│     resolved_any = false                                                    │
│     for delta in pendingDeltas:                                             │
│       base = resolvedObjects.get(delta.baseHash)                            │
│             ?? await existingObjects.read(delta.baseHash)                   │
│       if base:                                                              │
│         resolved = applyDelta(base.data, delta.deltaData)                   │
│         oid = computeOid(base.type, resolved)                               │
│         resolvedObjects.set(oid, { type: base.type, data: resolved })       │
│         indexEntries.push({ oid, type, offset, isDelta: true, baseOid })    │
│         remove from pendingDeltas                                           │
│         resolvedCount += 1                                                  │
│         onProgress({ type: 'resolving_deltas', current: resolvedCount })    │
│         resolved_any = true                                                 │
│                                                                             │
│     if !resolved_any && pendingDeltas.length > 0:                           │
│       return Error("DELTA_BASE_NOT_FOUND")                                  │
│                                                                             │
│   Pass 3: Write to SQLite                                                   │
│   ───────────────────────                                                   │
│   onProgress({ type: 'writing_index', count: indexEntries.length })         │
│   transaction:                                                              │
│     insert into git_packs (packId, r2Key, objectCount, ...)                 │
│     batch insert into git_object_index                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 3: Integration

#### 3.1 Update `src/do/hybrid-repo.ts`

```typescript
import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { R2 } from "./r2";
import { PackIndexer } from "./pack-indexer";
import { RefStore } from "./ref-store";
import { ObjectStore } from "./object-store";
import * as schema from "./schema/git";

export class HybridRepo extends DurableObject<Env> {
  // ... existing setup ...

  /**
   * Handle git-receive-pack request.
   * Returns a streaming response with sideband progress.
   */
  async receivePack(
    packStream: ReadableStream<Uint8Array>,
    commands: RefUpdate[],
  ): Promise<Response> {
    const packId = `pack-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const r2Key = `${this.repoPrefix}/packs/${packId}.pack`;

    // Create response stream for progress + status
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();

    // Process in background, streaming progress
    this.ctx.waitUntil(
      (async () => {
        try {
          // 1. Tee stream: one to R2, one to parser
          const [r2Stream, parseStream] = packStream.tee();

          // 2. Upload to R2
          const uploadResult = await this.r2.put(r2Key, r2Stream);
          if (uploadResult.isErr()) {
            await writer.write(
              PktLine.encodeProgress(
                `remote: error: ${uploadResult.error.message}\n`,
              ),
            );
            await writer.write(
              PktLine.encode(`unpack ${uploadResult.error.message}\n`),
            );
            await writer.write(PktLine.encodeFlush());
            await writer.close();
            return;
          }

          // 3. Index the pack with progress
          const indexResult = await this.indexer.index(
            packId,
            r2Key,
            parseStream,
            async (event) => {
              if (event.type === "unpacking") {
                await writer.write(
                  PktLine.encodeProgress(
                    `remote: Unpacking objects: ${percent(event.current, event.total)}% (${event.current}/${event.total})${event.current === event.total ? ", done.\n" : "\r"}`,
                  ),
                );
              } else if (event.type === "resolving_deltas") {
                await writer.write(
                  PktLine.encodeProgress(
                    `remote: Resolving deltas: ${percent(event.current, event.total)}% (${event.current}/${event.total})${event.current === event.total ? ", done.\n" : "\r"}`,
                  ),
                );
              }
            },
          );

          if (indexResult.isErr()) {
            await this.r2.delete(r2Key);
            await writer.write(
              PktLine.encodeProgress(
                `remote: error: ${indexResult.error.message}\n`,
              ),
            );
            await writer.write(
              PktLine.encode(`unpack ${indexResult.error.message}\n`),
            );
            await writer.write(PktLine.encodeFlush());
            await writer.close();
            return;
          }

          // 4. Apply ref updates
          const refResults = await this.refs.applyUpdates(commands);

          await writer.write(
            PktLine.encodeProgress(
              `remote: Processing changes: refs: ${commands.length}, done.\n`,
            ),
          );

          // 5. Send final status
          await writer.write(PktLine.encode("unpack ok\n"));
          for (const result of refResults) {
            if (result.ok) {
              await writer.write(PktLine.encode(`ok ${result.name}\n`));
            } else {
              await writer.write(
                PktLine.encode(`ng ${result.name} ${result.error}\n`),
              );
            }
          }
          await writer.write(PktLine.encodeFlush());
          await writer.close();
        } catch (error) {
          await writer.write(
            PktLine.encodeSidebandError(`fatal: ${String(error)}\n`),
          );
          await writer.close();
        }
      })(),
    );

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "application/x-git-receive-pack-result",
        "Cache-Control": "no-cache",
      },
    });
  }
}

function percent(current: number, total: number): number {
  return total === 0 ? 100 : Math.floor((current / total) * 100);
}
```

## Error Handling Strategy

All errors use `TaggedError` from `better-result`:

```typescript
// Each module defines its own error class
export class DeltaError extends TaggedError("DeltaError")<{...}>() {}
export class ObjectError extends TaggedError("ObjectError")<{...}>() {}
export class PackIndexError extends TaggedError("PackIndexError")<{...}>() {}
export class RefError extends TaggedError("RefError")<{...}>() {}

// Higher-level errors wrap lower-level ones
export class ReceivePackError extends TaggedError("ReceivePackError")<{
  code: "UPLOAD_FAILED" | "INDEX_FAILED" | "REF_UPDATE_FAILED"
  message: string
  cause?: DeltaError | PackIndexError | RefError | R2Error
}>() {}
```

## Testing Strategy

### Unit Tests (Pure Git Layer)

```typescript
// src/git/delta.test.ts
describe("Delta.apply", () => {
  it("applies insert-only delta", () => { ... })
  it("applies copy-only delta", () => { ... })
  it("applies mixed delta", () => { ... })
  it("returns error for invalid header", () => { ... })
  it("returns error for size mismatch", () => { ... })
})

// src/git/object.test.ts
describe("GitObject.computeOid", () => {
  it("computes correct OID for blob", () => {
    const data = new TextEncoder().encode("hello world\n")
    const oid = GitObject.computeOid("blob", data)
    expect(oid).toBe("3b18e512dba79e4c8300dd08aeb37f8e728b8dad")
  })
})
```

### Integration Tests (Storage Layer)

Use Miniflare for D1/R2/DO testing:

```typescript
// src/do/pack-indexer.test.ts
describe("PackIndexer", () => {
  it("indexes a simple pack with no deltas", async () => { ... })
  it("indexes a pack with ref_delta objects", async () => { ... })
  it("rejects pack with ofs_delta", async () => { ... })
  it("handles thin pack (base in existing storage)", async () => { ... })
})
```

## Implementation Checklist

### Phase 1: Pure Git Primitives

- [x] Create `src/git/delta.ts`
  - [x] Implement varint parsing
  - [x] Implement delta header parsing
  - [x] Implement copy/insert instruction parsing
  - [x] Implement `Delta.apply()`
  - [ ] Add unit tests

- [x] Create `src/git/object.ts`
  - [x] Implement `GitObject.computeOid()`
  - [x] Implement `GitObject.wrap()`
  - [x] Implement `GitObject.unwrap()`
  - [ ] Add unit tests

### Phase 2: Storage Layer

- [x] Create `src/do/ref-store.ts`
  - [x] Implement `get()`
  - [x] Implement `list()`
  - [x] Implement `resolve()`
  - [x] Implement `applyUpdates()`
  - [x] Implement `setSymbolic()`

- [x] Create `src/do/object-store.ts`
  - [x] Implement `has()`
  - [x] Implement `read()` with delta resolution
  - [x] Implement coalesced R2 range requests
  - [x] Implement recursive CTE for delta chains

- [x] Create `src/do/pack-indexer.ts`
  - [x] Implement base object indexing
  - [x] Implement delta resolution loop
  - [x] Implement SQLite batch writes
  - [x] Add progress callback support

### Phase 3: Integration

- [x] Update `src/do/hybrid-repo.ts`
  - [x] Wire up all components
  - [x] Implement `receivePack()` with streaming response
  - [x] Add stream tee for R2 + parser

- [x] Update `src/git/protocol.ts`
  - [x] Add `encodeReportStatusLines()` helper for streaming

- [x] Update route handler
  - [x] Switch to HybridRepo DO
  - [x] Return streaming response

### Phase 4: Testing & Cleanup

- [ ] Add unit tests for delta.ts
- [ ] Add unit tests for object.ts
- [ ] Add integration tests with Miniflare
- [ ] Test with real git client
- [ ] Performance testing with large packs
- [ ] Error handling edge cases

## Open Questions

1. **Pack size limit**: What's the maximum pack size we accept? Suggested: 100MB initially.

2. **Thin pack support**: Currently object-store.ts supports reading existing objects for thin packs. Need to verify this works in pack-indexer.

3. **Concurrent pushes**: DO handles serialization automatically. Should be fine.

4. **Capabilities negotiation**: We advertise `no-thin` currently. If we want thin pack support, remove it.

5. **OFS_DELTA**: We don't advertise it, but should still reject gracefully if client sends one.
