# Codebase Audit Report

## 1. Bugs

### A. Critical Data Integrity Issues in File System
The current implementation of the file system (using `dofs` and `IsoGitFs`) lacks transactional integrity for critical operations.

- **Non-Atomic Writes:** In `dofs` (`packages/dofs/src/Fs.ts`), `writeFile` operations delete the existing file (`unlink`) before writing the new content. If the write fails (e.g., due to power loss, memory limit, or storage limit), the file is lost completely. `isomorphic-git` relies on the file system for some level of reliability.
- **Missing Transactions:** Operations like `rename` or `writeFile` involve multiple SQL statements (`DELETE`, `INSERT`, `UPDATE`). These are not wrapped in a `dofs`-level transaction (though they might be within the implicit DO transaction if synchronous, `await` points break atomicity). A crash in between leaves the DB in an inconsistent state (e.g., file entry exists but chunks are missing, or vice versa).

### B. Memory Usage & Performance Bugs
- **OOM Risk in `dofs`:** The `read` method in `dofs` loads all chunks of a file into a single `Uint8Array` in memory (`result = new Uint8Array(end - offset)`). For large files (like Git packfiles), this will exceed the memory limit of the Durable Object (typically 128MB), causing the worker to crash.
- **Inefficient Space Calculation:** The `getSpaceUsed` and `updateFileSizeAndSpaceUsed` methods in `dofs` calculate used space by summing the length of *all* chunks in the `dofs_chunks` table (`SELECT SUM(length) as total FROM dofs_chunks`). As the repository grows, this `O(N)` operation (where N is the number of chunks) runs on every write, leading to severe performance degradation.

### C. Authentication Logic Limitation
- **Collaborator Push Blocked:**
  - `apps/web/src/lib/git-auth.ts`: `verifyAuth` logic assumes the `username` in Basic Auth must match the repository `owner` (`token = basic && basic.username === owner ? basic.password : undefined`). This prevents collaborators from authenticating with their own usernames.
  - `packages/backend/convex/repositories.ts`: `checkPermissionByPAT` strictly checks `if (isPushOperation && !isOwner)`. This effectively makes all repositories read-only for anyone except the owner, even if they have a valid token.

### D. Potential Configuration Issue
- **Missing `SITE_URL`:** `apps/web/src/do/cache.ts` relies on `env.SITE_URL` to construct cache keys. If this environment variable is not set (it is missing from `wrangler.jsonc` bindings), caching operations may fail or throw invalid URL errors.

### E. Error Suppression
- **Silent Failures:** In `apps/web/src/git/service.ts`, many methods (like `listBranches`, `readObject`) catch errors and return empty results or `null` without propagating the error or reporting it adequately. This masks genuine issues (like corrupted storage) as "not found".

## 2. Security Vulnerabilities

### A. Denial of Service (DoS) via Large Packfiles
- **Memory Exhaustion:** As mentioned in Bugs, uploading a large packfile (git push) can cause the Durable Object to crash due to OOM in `dofs`. An attacker could intentionally push large files to take down a repo.
- **Storage Quota:** While `dofs` attempts to enforce a quota, the inefficient calculation mechanism could be exploited to degrade performance (Resource Exhaustion).

### B. Data Loss Risk
- **Unsafe File Overwrite:** The `unlink`-before-`write` pattern in `dofs` is a security risk in terms of availability and integrity. Interrupted writes destroy data.

### C. Limited Access Control
- **No Collaborator Support:** While not a vulnerability *per se*, the current auth model forces password sharing (acting as the owner) if collaboration is needed, which is a security bad practice.

## 3. Improvements

### A. File System Enhancements
- **Streaming Support:** Update `dofs` to support streaming reads and writes natively using `ReadableStream` and `WritableStream`, interacting with SQLite incrementally without loading the full file.
- **Transactional Integrity:** Use SQLite transactions (via `ctx.storage.transaction` or explicit SQL `BEGIN/COMMIT`) to ensure operations like `rename` and `writeFile` are atomic.
- **Optimized Metadata:** Store `space_used` in a separate metadata table and update it incrementally (add/subtract size on write/delete) instead of recalculating from scratch.

### B. Git Protocol & Feature Support
- **Full Protocol v2:** Upgrade `apps/web/src/git/protocol.ts` to fully support Git Protocol v2, which improves fetch performance by filtering refs.
- **Git GC:** Implement `git gc` functionality. `isomorphic-git` creates loose objects and packfiles. Over time, these need to be consolidated and unreachable objects removed to save space and improve performance.
- **Delta Compression:** Ensure efficient packing is used. `isomorphic-git`'s packer is pure JS and might be slow; consider offloading heavy packing if possible or tuning it.

### C. Authentication
- **Role-Based Access Control (RBAC):** Update the Convex backend to support a `collaborators` table and check permissions based on user ID, allowing distinct users to push to the same repo.

## 4. Supporting Large Git Repositories (like git.git)

Supporting a repository the size of `git.git` (hundreds of MBs to GBs, millions of objects) on Cloudflare Workers/Durable Objects requires architectural changes:

### A. Hybrid Storage Strategy
- **Offload Blobs to R2:** Storing gigabytes of git objects in SQLite (DO storage) is expensive and hits storage limits.
  - Use SQLite (DO) for **refs** and **indices** (directory structure, commit graph) for fast lookup.
  - Store **packfiles** and loose **blobs** in **Cloudflare R2** (Object Storage). R2 is cheaper and supports large files.
  - `dofs` would need to be a hybrid driver: `stat` and directory listings come from SQLite, but file reads/writes stream to/from R2.

### B. Streaming Everywhere
- **Upload/Download:** The `git-receive-pack` and `git-upload-pack` handlers must fully stream data. `isomorphic-git` might struggle with this in a Service Worker environment if not carefully managed.
- **Custom Git Server:** `isomorphic-git` is great for clients or small server-side tasks, but for a scalable git host, a custom implementation of the git wire protocol that streams directly to/from storage (without loading full trees into JS objects) is preferred.

### C. Horizontal Sharding
- **Repo Sharding:** A single DO has a storage limit (though effectively high now with SQLite). For truly massive hosting, sharding data across multiple DOs might be needed (e.g., sharding by object ID prefix), though this adds significant complexity.
- **Compute Offloading:** Heavy operations (like packing objects for a clone) should be offloaded to a separate Worker or a dedicated service (e.g., using a Wasm-compiled `libgit2` or `git` binary if possible, or just a heavier compute worker) to avoid blocking the DO's main thread.

### D. Caching
- **Aggressive Caching:** Cache packfiles and object lookups heavily. The Cache API should be used to serve static packfiles directly, bypassing the DO execution for fetches where possible.
