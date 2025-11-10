import * as git from "isomorphic-git";
import type { IsoGitFs } from "@/do/fs";
import { createLogger } from "@/do/logger";

const logger = createLogger("GitService");

export type RefUpdateResult = {
  ref: string;
  ok: boolean;
  error?: string;
};

export class GitService {
  private readonly fs: ReturnType<IsoGitFs["getPromiseFsClient"]>;
  private readonly gitdir: string;

  private readonly cache: object = {};

  constructor(fs: ReturnType<IsoGitFs["getPromiseFsClient"]>, gitdir: string) {
    this.fs = fs;
    this.gitdir = gitdir;
  }

  async initRepo() {
    await git.init({
      fs: this.fs,
      dir: this.gitdir,
      bare: true,
      defaultBranch: "main",
    });
  }

  async listRefs() {
    let symbolicHead: string | null = null;
    const refs: Array<{ ref: string; oid: string }> = [];

    try {
      const headContent = await this.fs.promises.readFile("/repo/HEAD", {
        encoding: "utf-8",
      });
      const headStr =
        typeof headContent === "string"
          ? headContent
          : new TextDecoder().decode(headContent);
      const match = headStr.trim().match(/^ref:\s*(.+)$/);
      if (match) {
        symbolicHead = match[1]; // e.g., "refs/heads/main"
      }
    } catch {
      logger.warn("(read-head-file) No HEAD found in repository.");
    }

    try {
      const headOid = await git.resolveRef({
        fs: this.fs,
        gitdir: this.gitdir,
        ref: "HEAD",
      });
      refs.push({ ref: "HEAD", oid: headOid });
    } catch {
      logger.warn("(resolve-head-ref) No HEAD ref found in repository.");
    }

    const [branches, tags] = await Promise.all([
      this.listBranchesWithOid(),
      this.listTags(),
    ]);

    refs.push(...branches, ...tags);

    return { refs, symbolicHead };
  }

  async listBranchesWithOid(): Promise<Array<{ ref: string; oid: string }>> {
    try {
      const branchRefs = await git.listBranches({
        fs: this.fs,
        gitdir: this.gitdir,
      });
      const branches = await Promise.all(
        branchRefs.map(async (branch) => {
          const oid = await git.resolveRef({
            fs: this.fs,
            gitdir: this.gitdir,
            ref: `refs/heads/${branch}`,
          });
          return { ref: `refs/heads/${branch}`, oid };
        })
      );
      return branches;
    } catch {
      return [];
    }
  }

  async listBranches() {
    try {
      const branchRefs = await git.listBranches({
        fs: this.fs,
        gitdir: this.gitdir,
      });
      return branchRefs;
    } catch (error) {
      logger.warn("(list-branches) Failed to list branches: ", error);
      return [];
    }
  }

  async listTags(): Promise<Array<{ ref: string; oid: string }>> {
    try {
      const tagRefs = await git.listTags({
        fs: this.fs,
        gitdir: this.gitdir,
      });
      const tags = await Promise.all(
        tagRefs.map(async (tag) => {
          const oid = await git.resolveRef({
            fs: this.fs,
            gitdir: this.gitdir,
            ref: `refs/tags/${tag}`,
          });
          return { ref: `refs/tags/${tag}`, oid };
        })
      );
      return tags;
    } catch {
      return [];
    }
  }

  async readObject(oid: string) {
    try {
      return await git.readObject({
        fs: this.fs,
        gitdir: this.gitdir,
        oid,
        cache: this.cache,
      });
    } catch (error) {
      logger.warn(`(read-object) Failed to read object ${oid}: ${error}`);
      return null;
    }
  }

  async readObjectForLsRefs(oid: string) {
    try {
      const result = await git.readObject({
        fs: this.fs,
        gitdir: this.gitdir,
        oid,
        format: "content",
        cache: this.cache,
      });

      // Ensure we return string or Uint8Array
      const object = result.object;
      if (typeof object === "string" || object instanceof Uint8Array) {
        return {
          type: result.type,
          object,
        };
      }

      // If it's a parsed object, we need to serialize it
      // This shouldn't happen with format: "content", but handle it just in case
      return {
        type: result.type,
        object: new TextEncoder().encode(JSON.stringify(object)),
      };
    } catch (error) {
      logger.warn(
        `(read-object-ls-refs) Failed to read object ${oid}: ${error}`
      );
      return null;
    }
  }

  async expandRef(ref: string) {
    try {
      return await git.expandRef({
        fs: this.fs,
        gitdir: this.gitdir,
        ref,
      });
    } catch {
      return null;
    }
  }

  async indexPack(filePath: string) {
    await git.indexPack({
      fs: this.fs,
      dir: this.gitdir,
      gitdir: this.gitdir,
      filepath: filePath,
      cache: this.cache,
    });
  }

  async collectObjectsForPack(
    wants: string[],
    haves: string[]
  ): Promise<string[]> {
    const objectsToSend = new Set<string>();
    const visited = new Set<string>();
    const haveSet = new Set(haves);

    // BFS queue to traverse the commit graph
    const queue: string[] = [...wants];

    while (queue.length > 0) {
      const oid = queue.shift();
      if (!oid || visited.has(oid)) continue;

      visited.add(oid);

      // If the client already has this object, don't include it or traverse further
      if (haveSet.has(oid)) continue;

      // Add this object to the set of objects to send
      objectsToSend.add(oid);

      try {
        const { type } = await git.readObject({
          fs: this.fs,
          gitdir: this.gitdir,
          oid,
          cache: this.cache,
        });

        if (type === "commit") {
          // Parse commit to get tree and parent OIDs
          const commit = await git.readCommit({
            fs: this.fs,
            gitdir: this.gitdir,
            oid,
            cache: this.cache,
          });

          // Add tree to queue
          queue.push(commit.commit.tree);

          // Add parent commits to queue
          for (const parent of commit.commit.parent) {
            queue.push(parent);
          }
        } else if (type === "tree") {
          // Parse tree to get all entries (blobs and subtrees)
          const tree = await git.readTree({
            fs: this.fs,
            gitdir: this.gitdir,
            oid,
            cache: this.cache,
          });

          // Add all tree entries to queue
          for (const entry of tree.tree) {
            queue.push(entry.oid);
          }
        } else if (type === "tag") {
          // Parse tag to get the object it points to
          const tag = await git.readTag({
            fs: this.fs,
            gitdir: this.gitdir,
            oid,
            cache: this.cache,
          });

          queue.push(tag.tag.object);
        }
        // For blobs, we just add them to the set (no traversal needed)
      } catch (error) {
        logger.error(
          `(collect-objects) Failed to read object ${oid}: ${error}`
        );
        // Continue processing other objects even if one fails
      }
    }

    return Array.from(objectsToSend);
  }

  async packObjects(oids: string[]) {
    const result = await git.packObjects({
      fs: this.fs,
      dir: this.gitdir,
      gitdir: this.gitdir,
      oids,
      write: false,
      cache: this.cache,
    });

    return result.packfile;
  }

  async hasObject(oid: string): Promise<boolean> {
    try {
      await git.readObject({
        fs: this.fs,
        gitdir: this.gitdir,
        oid,
        cache: this.cache,
      });
      return true;
    } catch {
      return false;
    }
  }

  async findCommonCommits(haves: string[]): Promise<string[]> {
    const common: string[] = [];

    for (const oid of haves) {
      const hasObject = await this.hasObject(oid);
      if (hasObject) {
        common.push(oid);
      }
    }

    return common;
  }

  async getLastCommit(
    branch: string
  ): Promise<git.ReadCommitResult | undefined> {
    try {
      const [commit] = await git.log({
        fs: this.fs,
        gitdir: this.gitdir,
        ref: branch,
        depth: 1,
        cache: this.cache,
      });

      return commit ?? undefined;
    } catch (error) {
      logger.warn(
        `(get-last-commit) Failed to get last commit for branch ${branch}: ${error}`
      );
      return undefined;
    }
  }

  async getLog({
    ref,
    depth,
    filepath,
  }: {
    ref?: string;
    depth?: number;
    filepath?: string;
  }) {
    try {
      const commits = await git.log({
        fs: this.fs,
        gitdir: this.gitdir,
        cache: this.cache,
        ref,
        depth,
        filepath,
      });

      return commits;
    } catch (error) {
      logger.warn(`(get-log) Failed to get log for ref ${ref}: ${error}`);
      return [];
    }
  }

  async resolveRef(ref: string) {
    try {
      const oid = await git.resolveRef({
        fs: this.fs,
        gitdir: this.gitdir,
        ref,
      });
      return oid;
    } catch (error) {
      logger.warn(`(resolve-ref) Failed to resolve ref ${ref}: ${error}`);
      return null;
    }
  }

  async getTree(resolvedRef: string, path = "") {
    try {
      const { tree } = await git.readTree({
        fs: this.fs,
        gitdir: this.gitdir,
        oid: resolvedRef,
        filepath: path,
        cache: this.cache,
      });

      return tree;
    } catch (error) {
      logger.error(
        `(get-tree) Failed to get tree for ${resolvedRef}:${path}: ${error}`
      );
      return [];
    }
  }

  async getBlob(resolvedRef: string, filepath: string) {
    try {
      const { blob, oid } = await git.readBlob({
        fs: this.fs,
        gitdir: this.gitdir,
        oid: resolvedRef,
        filepath,
        cache: this.cache,
      });
      const isBinary = this.detectBinary(blob);

      return {
        oid,
        content: blob,
        size: blob.length,
        isBinary,
      };
    } catch (error) {
      logger.error(
        `(get-blob) Failed to get blob for ${resolvedRef}:${filepath}: ${error}`
      );
      return null;
    }
  }

  getBlobSize(content: Uint8Array): number {
    return content.length;
  }

  detectBinary(content: Uint8Array): boolean {
    // Check first 8000 bytes for null bytes (common binary file indicator)
    const bytesToCheck = Math.min(8000, content.length);
    for (let i = 0; i < bytesToCheck; i += 1) {
      if (content[i] === 0) {
        return true;
      }
    }
    return false;
  }

  // TODO: simplify this and some docs
  async applyRefUpdates(
    commands: Array<{ oldOid: string; newOid: string; ref: string }>,
    atomic: boolean
  ): Promise<RefUpdateResult[]> {
    const results: RefUpdateResult[] = [];
    const ZERO_OID = "0".repeat(40);

    // Validate all commands first
    for (const cmd of commands) {
      const isDelete = cmd.newOid === ZERO_OID;
      const isCreate = cmd.oldOid === ZERO_OID;

      try {
        let currentOid: string | null = null;
        try {
          currentOid = await git.resolveRef({
            fs: this.fs,
            gitdir: "/repo",
            ref: cmd.ref,
          });
        } catch {
          logger.info(`(apply-ref-updates): Ref ${cmd.ref} does not exist.`);
        }

        // Validate old OID matches current
        if (
          currentOid &&
          cmd.oldOid !== ZERO_OID &&
          currentOid !== cmd.oldOid
        ) {
          results.push({
            ref: cmd.ref,
            ok: false,
            error: "ref update rejected: old OID mismatch",
          });
          continue;
        }

        if (isDelete) {
          // Delete ref
          if (currentOid) {
            results.push({ ref: cmd.ref, ok: true });
          } else {
            results.push({
              ref: cmd.ref,
              ok: false,
              error: "ref doesn't exist",
            });
          }
        } else if (isCreate) {
          // Create new ref
          if (currentOid) {
            results.push({
              ref: cmd.ref,
              ok: false,
              error: "ref already exists",
            });
          } else {
            results.push({ ref: cmd.ref, ok: true });
          }
        } else {
          // Update existing ref - check fast-forward
          if (!currentOid) {
            results.push({
              ref: cmd.ref,
              ok: false,
              error: "ref doesn't exist",
            });
            continue;
          }

          const isFF = await git.isDescendent({
            fs: this.fs,
            gitdir: "/repo",
            oid: cmd.newOid,
            ancestor: currentOid,
          });

          if (isFF) {
            results.push({ ref: cmd.ref, ok: true });
          } else {
            results.push({
              ref: cmd.ref,
              ok: false,
              error: "non-fast-forward update rejected",
            });
          }
        }
      } catch (error) {
        results.push({
          ref: cmd.ref,
          ok: false,
          error: (error as Error).message,
        });
      }
    }

    // If atomic and any failed, fail all
    if (atomic && results.some((r) => !r.ok)) {
      return results.map((r) => ({
        ...r,
        ok: false,
        error: r.error || "atomic transaction failed",
      }));
    }

    // Apply successful updates
    for (let i = 0; i < commands.length; i += 1) {
      if (!results[i].ok) continue;

      const cmd = commands[i];
      const isDelete = cmd.newOid === ZERO_OID;

      try {
        if (isDelete) {
          await git.deleteRef({
            fs: this.fs,
            gitdir: "/repo",
            ref: cmd.ref,
          });
        } else {
          await git.writeRef({
            fs: this.fs,
            gitdir: "/repo",
            ref: cmd.ref,
            value: cmd.newOid,
            force: true,
          });
        }
      } catch (error) {
        results[i] = {
          ref: cmd.ref,
          ok: false,
          error: `failed to update: ${(error as Error).message}`,
        };
      }
    }

    return results;
  }
}
