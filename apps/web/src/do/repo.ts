import { DurableObject, env } from "cloudflare:workers";
import { Fs } from "dofs";
import { buildReportStatus, parseReceivePackRequest } from "@/git/protocol";
import { GitService } from "@/git/service";
import { IsoGitFs } from "./fs";
import { createLogger } from "./logger";

export function getRepoDOStub(fullRepoName: string) {
  return env.REPO.getByName(fullRepoName);
}

const logger = createLogger("RepoDO");

/**
 * Durable Object (DO) to manage a Git repository using isomorphic-git and DOFS.
 * Each DO instance represents a single Git repository.
 * All the data like objects, refs, packfiles and config are stored in DO SQLite storage via DOFS.
 */
export class Repo extends DurableObject<Env> {
  private readonly dofs: Fs;
  private readonly isoGitFs: ReturnType<IsoGitFs["getPromiseFsClient"]>;
  private readonly git: GitService;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.dofs = new Fs(ctx, env, { chunkSize: 512 * 1024 }); // 512KB chunks
    this.dofs.setDeviceSize(5 * 1024 * 1024 * 1024); // 5GB device size to support large repos

    this.isoGitFs = new IsoGitFs(this.dofs).getPromiseFsClient();
    this.git = new GitService(this.isoGitFs, "/repo");

    this.ctx.blockConcurrencyWhile(async () => {
      await this.ensureRepoInitialized();
    });
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/git-receive-pack" && request.method === "POST") {
      const data = new Uint8Array(await request.arrayBuffer());
      const result = await this.receivePack(data);
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
}
