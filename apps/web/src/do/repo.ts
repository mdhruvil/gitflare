import { DurableObject, env } from "cloudflare:workers";
import * as Sentry from "@sentry/cloudflare";
import { Fs } from "dofs";
import {
  buildFetchResponse,
  buildLsRefsResponse,
  buildReportStatus,
  parseCommand,
  parseFetchRequest,
  parseReceivePackRequest,
} from "@/git/protocol";
import { GitService } from "@/git/service";
import { cache } from "./cache";
import { IsoGitFs } from "./fs";
import { createLogger } from "./logger";

export function getRepoDOStub(fullRepoName: string) {
  const stub = (env.REPO as DurableObjectNamespace<RepoBase>).getByName(
    fullRepoName
  );
  stub.setFullName(fullRepoName);
  return stub;
}

const logger = createLogger("RepoDO");

type Storage = {
  fullName: string;
  testKey: number;
  anotherKey: boolean;
  yetAnotherKey: string;
};

/**
 * Durable Object (DO) to manage a Git repository using isomorphic-git and DOFS.
 * Each DO instance represents a single Git repository.
 * All the data like objects, refs, packfiles and config are stored in DO SQLite storage via DOFS.
 */
class RepoBase extends DurableObject<Env> {
  private readonly dofs: Fs;
  private readonly isoGitFs: ReturnType<IsoGitFs["getPromiseFsClient"]>;
  private readonly git: GitService;

  private _fullName: string | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.dofs = new Fs(ctx, env, { chunkSize: 512 * 1024 }); // 512KB chunks

    this.isoGitFs = new IsoGitFs(this.dofs).getPromiseFsClient();
    this.git = new GitService(this.isoGitFs, "/repo");

    this.ctx.blockConcurrencyWhile(async () => {
      this.dofs.setDeviceSize(5 * 1024 * 1024 * 1024); // 5GB device size to support large repos
      await this.ensureRepoInitialized();
      const storedFullName = await this.typedStorage.get("fullName");
      if (storedFullName && !this._fullName) {
        this._fullName = storedFullName;
      }
    });
  }

  get fullName() {
    if (!this._fullName) {
      throw new Error("Repository full name is not set");
    }
    return this._fullName;
  }

  async setFullName(fullName: string) {
    if (this._fullName) return;

    this._fullName = fullName;
    await this.typedStorage.put("fullName", fullName);
  }

  get typedStorage() {
    return {
      get: async <K extends keyof Storage>(key: K) =>
        this.ctx.storage.get<Storage[K]>(key),
      put: async <K extends keyof Storage>(key: K, value: Storage[K]) =>
        this.ctx.storage.put(key, value),
      delete: async <K extends keyof Storage>(key: K) =>
        this.ctx.storage.delete(key),
    };
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const data = new Uint8Array(await request.arrayBuffer());

    if (pathname === "/git-receive-pack" && request.method === "POST") {
      const result = await this.receivePack(data);
      return result;
    }

    if (pathname === "/git-upload-pack" && request.method === "POST") {
      const result = await this.uploadPack(data);
      return result;
    }

    return new Response("Not Found", { status: 404 });
  }

  getDeviceStats() {
    return this.dofs.getDeviceStats();
  }

  async initRepo() {
    await this.git.initRepo();
  }

  async ensureRepoInitialized() {
    try {
      await this.isoGitFs.promises.stat("/repo/HEAD");
    } catch {
      await this.initRepo();
    }
  }

  async listRefs() {
    return this.git.listRefs();
  }

  async receivePack(data: Uint8Array) {
    const { commands, packfile, capabilities } = parseReceivePackRequest(data);

    const packFilePath = `/repo/objects/pack/pack-${Date.now()}.pack`;
    await this.isoGitFs.promises.writeFile(packFilePath, packfile);

    try {
      await this.git.indexPack(packFilePath.replace("/repo/", ""));
    } catch (error) {
      // TODO: report status back to client
      logger.error("(receive-pack) Failed to index packfile: ", error);
      return buildReportStatus(
        [
          {
            ref: "*",
            ok: false,
            error: `unpack failed: ${(error as Error).message}`,
          },
        ],
        false
      );
    }

    const atomic = capabilities.includes("atomic");
    const results = await this.git.applyRefUpdates(commands, atomic);

    return buildReportStatus(results, true);
  }

  async uploadPack(data: Uint8Array) {
    const { command, args } = parseCommand(data);

    if (command === "ls-refs") {
      const { refs, symbolicHead } = await this.git.listRefs();

      const response = await buildLsRefsResponse(
        refs,
        args,
        symbolicHead,
        async (oid: string) => this.git.readObjectForLsRefs(oid)
      );

      return response;
    }

    if (command === "fetch") {
      const fetchRequest = parseFetchRequest(data, args);

      // Find common commits between client and server
      const commonCommits = await this.git.findCommonCommits(
        fetchRequest.haves
      );

      // If client sent "done", we need to generate and send packfile
      let packfileData: Uint8Array | undefined | null = null;

      if (fetchRequest.done && fetchRequest.wants.length > 0) {
        // Walk the object graph to find all objects reachable from wants but not from haves
        try {
          const objectsToPack = await this.git.collectObjectsForPack(
            fetchRequest.wants,
            fetchRequest.haves
          );

          logger.info(
            `(upload-pack-fetch) Packing ${objectsToPack.length} objects for wants: ${fetchRequest.wants.join(", ")}`
          );

          packfileData = await this.git.packObjects(objectsToPack);
        } catch (error) {
          logger.error("(upload-pack-fetch) Failed to pack objects: ", error);
          return new Response(
            `ERR pack-objects failed: ${(error as Error).message}`,
            { status: 500 }
          );
        }
      }

      const response = await buildFetchResponse({
        commonCommits,
        packfileData,
        noProgress: fetchRequest.capabilities.noProgress,
        done: fetchRequest.done,
      });

      return response;
    }

    return new Response("Unsupported command", { status: 400 });
  }

  async getLatestCommit(branch = "HEAD") {
    const commit = await this.git.getLastCommit(branch);
    return commit;
  }

  async getCommits(args: { ref?: string; depth?: number; filepath?: string }) {
    const { ref, depth, filepath } = args;

    const latestCommit = await this.getLatestCommit(ref);
    if (!latestCommit) {
      return [];
    }

    const commits = await cache.getOrSetJson({
      key: `${this.fullName}/commits`,
      fetcher: async () => await this.git.getLog(args),
      params: {
        ref,
        depth: depth?.toString(),
        filepath,
        latestCommitOid: latestCommit.oid,
      },
    });
    return commits;
  }

  async getBranches() {
    const branches = await this.git.listBranches();
    return branches;
  }

  async getTree(args: { ref: string; path?: string }) {
    const { ref, path } = args;

    const resolvedRef = await this.git.resolveRef(ref);
    if (!resolvedRef) {
      return [];
    }

    const tree = await this.git.getTree(resolvedRef, path);

    const treeWithLastCommit = await Promise.all(
      tree.map(async (item) => {
        const lastCommit = await this.git.getLog({
          ref,
          depth: 1,
          filepath: path ? `${path}/${item.path}` : item.path,
        });
        return { ...item, lastCommit: lastCommit[0] || null };
      })
    );
    logger.debug(`get-tree, ref:${resolvedRef}, path:${path}`);

    return treeWithLastCommit;
  }

  async getBlob(args: { ref: string; filepath: string }) {
    const { ref, filepath } = args;

    const resolvedRef = await this.git.resolveRef(ref);
    if (!resolvedRef) {
      return null;
    }

    logger.debug(
      `get-blob, ref:${ref}, resolvedRef:${resolvedRef}, filepath:${filepath}`
    );
    const blob = await this.git.getBlob(resolvedRef, filepath);
    return blob;
  }
}

// Export your named class as defined in your wrangler config
export const Repo = Sentry.instrumentDurableObjectWithSentry(
  (_env: Env) => ({
    dsn: "https://412acc40471763ed76cfbd92c70a80e4@o4510288569106432.ingest.us.sentry.io/4510318411579392",
    tracesSampleRate: 1.0,
    enableLogs: true,
    integrations: [Sentry.consoleLoggingIntegration()],
  }),
  RepoBase
);
