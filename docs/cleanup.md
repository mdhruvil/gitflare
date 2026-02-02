# Git Backend Rewrite Plan

MOST IMPORTANAT: Do not create useless comments that simply describe what the code already says. Comments are for adding context around the code when that context is not immediately obvious.

## Status Before Rewrite

The codebase has two parallel git backend implementations:

### Old Implementation (isomorphic-git based)

Stores ALL git objects in Durable Objects SQLite via a virtual filesystem (DOFS).

| File              | Purpose                          | Lines |
| ----------------- | -------------------------------- | ----- |
| `do/repo.ts`      | DO using isomorphic-git          | 324   |
| `do/fs.ts`        | DOFS virtual filesystem          | ~200  |
| `do/cache.ts`     | isomorphic-git cache adapter     | ~50   |
| `do/logger.ts`    | isomorphic-git logger adapter    | ~30   |
| `git/service.ts`  | isomorphic-git wrapper           | 740   |
| `git/protocol.ts` | Protocol parsing (mixed old/new) | 693   |

**Problems:**

- DO SQLite has 128KB row limit - large objects fail
- No streaming - entire packfiles buffered in memory
- isomorphic-git designed for browser, not serverless

### New Implementation (hybrid R2 + SQLite)

Stores packfiles in R2, only metadata/refs in DO SQLite.

| File                 | Purpose                      | Status               |
| -------------------- | ---------------------------- | -------------------- |
| `do/hybrid-repo.ts`  | New DO with R2 storage       | Messy, needs rewrite |
| `do/pack-indexer.ts` | Custom packfile indexer      | Clean, keep          |
| `do/object-store.ts` | R2-backed object store       | Clean, keep          |
| `do/ref-store.ts`    | SQLite-backed refs           | Clean, keep          |
| `do/r2.ts`           | R2 wrapper with Result types | Clean, keep          |
| `git/pack/`          | Streaming packfile parser    | Clean, keep          |

**Problems with hybrid-repo.ts:**

- God class: routing + protocol + formatting + progress in one file
- Mixed error handling: Result pattern + try/catch
- Non-awaited writes in progress throttler
- Duplicated utilities (`concatUint8Arrays`)
- `@ts-expect-error` comments bypassing type safety

**Problems with protocol.ts:**

- 693 lines mixing receive-pack, fetch, ls-refs concerns
- No Result types for parsing
- Duplicated utilities
- Unused parameters, fragile fallbacks
- Response building scattered everywhere

---

## What We're Doing

Complete removal of old implementation + clean rewrite of protocol layer.

### Delete (old implementation)

```
apps/web/src/do/repo.ts
apps/web/src/do/fs.ts
apps/web/src/do/cache.ts
apps/web/src/do/logger.ts
apps/web/src/git/service.ts
apps/web/src/git/protocol.ts
```

### Keep (clean hybrid components)

```
apps/web/src/do/pack-indexer.ts
apps/web/src/do/object-store.ts
apps/web/src/do/ref-store.ts
apps/web/src/do/r2.ts
apps/web/src/do/keys.ts
apps/web/src/do/schema/git.ts
apps/web/src/git/pack/
apps/web/src/git/pkt.ts
apps/web/src/git/object.ts
apps/web/src/git/delta.ts
```

### Create (new clean architecture)

```
apps/web/src/lib/bytes.ts                    # shared byte utilities
apps/web/src/git/errors.ts                   # TaggedError types
apps/web/src/git/response.ts                 # git HTTP response builders
apps/web/src/git/sideband-writer.ts          # sideband protocol abstraction
apps/web/src/git/protocol/receive-pack.ts    # receive-pack parsing + encoding
apps/web/src/git/protocol/capabilities.ts    # capability advertisement
apps/web/src/git/handlers/receive-pack.ts    # receive-pack business logic
```

### Rewrite

```
apps/web/src/do/hybrid-repo.ts               # simplify to routing only (~150 lines)
```

---

## Why We're Doing This

1. **Eliminate dead code**: Old isomorphic-git implementation is unused, adds confusion
2. **Single source of truth**: One git backend, not two parallel implementations
3. **Clean architecture**: Separation of concerns - routing, parsing, business logic, response building
4. **Consistent error handling**: All Result<T, TaggedError>, no mixed try/catch
5. **Type safety**: Remove all `@ts-expect-error` comments
6. **Maintainability**: Smaller focused modules instead of 700-line files
7. **Streaming-first**: Proper sideband writer with awaited writes

---

## New Architecture

```
                                    ┌─────────────────────────────────────┐
                                    │           HybridRepo DO             │
                                    │  (routing + lifecycle only, ~150L)  │
                                    └─────────────────┬───────────────────┘
                                                      │
                              ┌───────────────────────┼───────────────────────┐
                              │                       │                       │
                              ▼                       ▼                       ▼
                    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
                    │  /info/refs     │    │ /receive-pack   │    │  /upload-pack   │
                    │  (capability    │    │                 │    │  (future)       │
                    │   advertisement)│    │                 │    │                 │
                    └────────┬────────┘    └────────┬────────┘    └─────────────────┘
                             │                      │
                             ▼                      ▼
                    ┌─────────────────┐    ┌─────────────────┐
                    │  capabilities   │    │ parseReceive-   │
                    │  .ts            │    │ PackRequest()   │
                    └─────────────────┘    └────────┬────────┘
                                                    │
                                                    ▼ Result<ReceivePackRequest, ProtocolError>
                                           ┌─────────────────┐
                                           │ handleReceive-  │
                                           │ Pack()          │
                                           └────────┬────────┘
                                                    │
                    ┌───────────────────────────────┼───────────────────────────────┐
                    │                               │                               │
                    ▼                               ▼                               ▼
           ┌─────────────────┐            ┌─────────────────┐            ┌─────────────────┐
           │  PackIndexer    │            │  R2.put()       │            │  RefStore       │
           │  .index()       │            │  (store pack)   │            │  .applyUpdates()│
           └─────────────────┘            └─────────────────┘            └─────────────────┘
                    │
                    ▼
           ┌─────────────────┐
           │ SidebandWriter  │ ──────▶ Response stream
           │ (progress/status)│
           └─────────────────┘
```

---

## Implementation Plan

### Phase 1: Foundation ✅ DONE

Create shared utilities and error types.

**1.1 `lib/bytes.ts`**

```ts
export function concatUint8Arrays(
  arrays: Uint8Array[],
  totalLength: number,
): Uint8Array;
```

**1.2 `git/errors.ts`**

```ts
import { TaggedError } from "better-result";

export class ProtocolError extends TaggedError("ProtocolError")<{
  code:
    | "invalid_pkt_line"
    | "malformed_command"
    | "missing_flush"
    | "invalid_packfile";
  detail?: string;
}> {}

export class ReceivePackError extends TaggedError("ReceivePackError")<{
  code: "parse_failed" | "index_failed" | "upload_failed" | "ref_update_failed";
  cause?: Error;
}> {}
```

**1.3 `git/response.ts`**

```ts
type GitService = "upload-pack" | "receive-pack";

export function gitResponse(
  body: Uint8Array,
  service: GitService,
  type: "advertisement" | "result",
): Response;
export function gitStreamResponse(
  body: ReadableStream<Uint8Array>,
  service: GitService,
): Response;
```

### Phase 2: Sideband Abstraction ✅ DONE

**2.1 `git/sideband-writer.ts`**

```ts
export class SidebandWriter {
  constructor(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    enabled: boolean,
  );

  async writeData(data: Uint8Array): Promise<void>;
  async writeProgress(msg: string): Promise<void>;
  async writeError(msg: string): Promise<void>;
  async flush(): Promise<void>;
  async close(): Promise<void>;
}

export class ProgressReporter {
  constructor(writer: SidebandWriter, throttleMs?: number);
  async report(event: ProgressEvent): Promise<void>;
}
```

### Phase 3: Protocol Layer ✅ DONE

**3.1 `git/protocol/receive-pack.ts`**

```ts
import { Result } from "better-result";

export type Command = { oldOid: string; newOid: string; ref: string };

export type ReceivePackRequest = {
  commands: Command[];
  capabilities: string[];
  packfileStream: ReadableStream<Uint8Array> | null;
};

export function parseReceivePackRequest(
  stream: ReadableStream<Uint8Array>,
): Promise<Result<ReceivePackRequest, ProtocolError>>;

export function encodeUnpackStatus(ok: boolean, error?: string): Uint8Array;
export function encodeRefStatus(
  name: string,
  ok: boolean,
  error?: string,
): Uint8Array;
```

**3.2 `git/protocol/capabilities.ts`**

```ts
export type Ref = { name: string; oid: string };

export function advertiseReceivePackCapabilities(
  refs: Ref[],
  symbolicHead: string | null,
): Uint8Array;
```

### Phase 4: Handler ✅ DONE

**4.1 `git/handlers/receive-pack.ts`**

```ts
import { Result } from "better-result";

export type ReceivePackContext = {
  r2: R2;
  refs: RefStore;
  indexer: PackIndexer;
  repoPath: string;
};

export function handleReceivePack(
  ctx: ReceivePackContext,
  request: ReceivePackRequest,
  useSideband: boolean,
): Promise<Result<ReadableStream<Uint8Array>, ReceivePackError>>;
```

### Phase 5: Rewrite HybridRepo ✅ DONE

Simplify to routing only:

```ts
export class HybridRepo extends DurableObject<Env> {
  // ... constructor, lifecycle methods ...

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/info/refs") {
      return this.handleInfoRefs(url);
    }

    if (url.pathname === "/git-receive-pack") {
      return this.handleReceivePack(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async handleInfoRefs(url: URL): Promise<Response> {
    const service = url.searchParams.get("service");
    if (service === "git-receive-pack") {
      const { refs, symbolicHead } = await this.listRefs();
      const body = advertiseReceivePackCapabilities(refs, symbolicHead);
      return gitResponse(body, "receive-pack", "advertisement");
    }
    return new Response("Unknown service", { status: 400 });
  }

  private async handleReceivePack(request: Request): Promise<Response> {
    if (!request.body) {
      return gitErrorResponse("No request body", "receive-pack");
    }

    const parseResult = await parseReceivePackRequest(request.body);
    if (parseResult.isErr()) {
      return gitErrorResponse(parseResult.error.message, "receive-pack");
    }

    const { commands, capabilities, packfileStream } = parseResult.value;
    const useSideband = capabilities.includes("side-band-64k");

    const result = await handleReceivePack(
      {
        r2: this.r2,
        refs: this.refs,
        indexer: this.indexer,
        repoPath: this.fullName,
      },
      parseResult.value,
      useSideband,
    );

    if (result.isErr()) {
      return gitErrorResponse(result.error.message, "receive-pack");
    }

    return gitStreamResponse(result.value, "receive-pack");
  }
}
```

### Phase 6: Delete Old Files ✅ DONE

Remove after new implementation is complete and tested:

```bash
rm apps/web/src/do/repo.ts
rm apps/web/src/do/fs.ts
rm apps/web/src/do/cache.ts
rm apps/web/src/do/logger.ts
rm apps/web/src/git/service.ts
rm apps/web/src/git/protocol.ts
```

---

## Success Criteria

- [ ] Old implementation files deleted
- [ ] `hybrid-repo.ts` under 200 lines (routing only)
- [ ] All parsing returns `Result<T, TaggedError>`
- [ ] No `@ts-expect-error` comments
- [ ] No duplicated utilities
- [ ] All `writer.write()` calls properly awaited
- [ ] `pnpm check` passes

---

## Scope

**In scope:**

- receive-pack (git push) functionality
- Capability advertisement for receive-pack
- Clean error handling with Result types
- Streaming response with proper sideband

**Out of scope (future work):**

- upload-pack (git fetch/clone)
- Protocol v2 upgrade for receive-pack
- Web UI features (getTree, getBlob, etc.)
