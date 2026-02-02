import { DurableObject, env } from "cloudflare:workers";
import { Result } from "better-result";
import {
  type DrizzleSqliteDODatabase,
  drizzle,
} from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { handleReceivePack } from "@/git/handlers/receive-pack";
import { handleUploadPackV2 } from "@/git/handlers/upload-pack";
import { advertiseReceivePackCapabilities } from "@/git/protocol/capabilities";
import { parseReceivePackRequest } from "@/git/protocol/receive-pack";
import { advertiseV2Capabilities } from "@/git/protocol/upload-pack-v2";
import {
  gitErrorResponse,
  gitResponse,
  gitStreamResponse,
} from "@/git/response";
// @ts-expect-error - drizzle-orm script
import migrations from "../../drizzle-do/migrations.js";
import { ObjectStore } from "./object-store";
import { PackIndexer } from "./pack-indexer";
import { R2 } from "./r2";
import { RefStore } from "./ref-store";
import * as gitSchema from "./schema/git";

export function getHybridRepoDOStub(fullRepoName: string) {
  const stub = (
    env.HYBRID_REPO as DurableObjectNamespace<HybridRepo>
  ).getByName(fullRepoName);
  stub.setFullName(fullRepoName);
  return stub;
}

type DB = DrizzleSqliteDODatabase<typeof gitSchema>;

type Storage = {
  fullName: string;
  objectCount: number;
  lastPushAt: number;
};

export class HybridRepo extends DurableObject<Env> {
  private readonly db: DB;
  private readonly r2: R2;
  private readonly refs: RefStore;
  private readonly objects: ObjectStore;
  private readonly indexer: PackIndexer;

  private _fullName: string | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.db = drizzle(ctx.storage, { schema: gitSchema });
    this.r2 = new R2(env.BUCKET);

    this.refs = new RefStore(this.db);
    this.objects = new ObjectStore(this.db, this.r2);
    this.indexer = new PackIndexer({
      db: this.db,
      existingObjects: this.objects,
    });

    ctx.blockConcurrencyWhile(async () => {
      await this._migrate();
      const storedFullName = await this.typedStorage.get("fullName");
      if (storedFullName && !this._fullName) {
        this._fullName = storedFullName;
      }
    });
  }

  _migrate() {
    return migrate(this.db, migrations);
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

  async ping(): Promise<string> {
    return "pong";
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/info/refs" && request.method === "GET") {
      return this.routeInfoRefs(request, url);
    }

    if (url.pathname === "/git-receive-pack" && request.method === "POST") {
      return this.routeReceivePack(request);
    }

    if (url.pathname === "/git-upload-pack" && request.method === "POST") {
      return this.routeUploadPack(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async routeInfoRefs(_request: Request, url: URL): Promise<Response> {
    const service = url.searchParams.get("service");

    if (service === "git-receive-pack") {
      const { refs, symbolicHead } = await this.listRefs();
      const capsRefs = refs.map((r) => ({ name: r.ref, oid: r.oid }));
      const body = advertiseReceivePackCapabilities(capsRefs, symbolicHead);
      return gitResponse(body, "receive-pack", "advertisement");
    }

    if (service === "git-upload-pack") {
      return gitResponse(
        advertiseV2Capabilities(),
        "upload-pack",
        "advertisement"
      );
    }

    return new Response("Unknown service", { status: 400 });
  }

  private async routeReceivePack(request: Request): Promise<Response> {
    const result = await Result.gen(
      async function* (this: HybridRepo) {
        if (!request.body) {
          return Result.err({ message: "No request body" });
        }

        const parsed = yield* Result.await(
          parseReceivePackRequest(request.body)
        );
        const useSideband = parsed.capabilities.includes("side-band-64k");

        const stream = yield* handleReceivePack(
          {
            r2: this.r2,
            refs: this.refs,
            indexer: this.indexer,
            repoPath: this.fullName,
            onIndexed: async (objectCount) => {
              const prevCount =
                (await this.typedStorage.get("objectCount")) ?? 0;
              await this.typedStorage.put(
                "objectCount",
                prevCount + objectCount
              );
              await this.typedStorage.put("lastPushAt", Date.now());
            },
          },
          parsed,
          useSideband
        );

        return Result.ok(gitStreamResponse(stream, "receive-pack"));
      }.bind(this)
    );

    if (result.isErr()) {
      return gitErrorResponse(result.error.message, "receive-pack");
    }

    return result.value;
  }

  async listRefs() {
    const refsResult = await this.refs.list();
    if (refsResult.isErr()) {
      return { refs: [], symbolicHead: null };
    }

    const allRefs = refsResult.value;
    let symbolicHead: string | null = null;

    const refs: Array<{ ref: string; oid: string }> = [];

    for (const ref of allRefs) {
      if (ref.name === "HEAD" && ref.isSymbolic) {
        symbolicHead = ref.value;
        const resolvedResult = await this.refs.resolve("HEAD");
        if (resolvedResult.isOk()) {
          refs.push({ ref: "HEAD", oid: resolvedResult.value });
        }
      } else if (!ref.isSymbolic) {
        refs.push({ ref: ref.name, oid: ref.value });
      }
    }

    return { refs, symbolicHead };
  }

  async initRepo(): Promise<void> {
    await this.refs.setSymbolic("HEAD", "refs/heads/main");
  }

  /**
   * Detect protocol version from Git-Protocol header.
   */
  private getProtocolVersion(request: Request): 1 | 2 {
    const proto = request.headers.get("Git-Protocol");
    console.log("Git-Protocol header:", proto);
    if (proto?.includes("version=2")) return 2;
    return 1;
  }

  /**
   * Route POST /git-upload-pack requests (protocol v2 only).
   */
  private async routeUploadPack(request: Request): Promise<Response> {
    const version = this.getProtocolVersion(request);
    if (version !== 2) {
      return new Response("Protocol version 2 required", { status: 400 });
    }

    if (!request.body) {
      return gitErrorResponse("No request body", "upload-pack");
    }

    const result = await handleUploadPackV2(
      {
        db: this.db,
        refs: this.refs,
        objects: this.objects,
        waitUntil: (promise: Promise<unknown>) => this.ctx.waitUntil(promise),
      },
      request.body
    );

    if (result.isErr()) {
      return gitErrorResponse(result.error.message, "upload-pack");
    }

    return result.value;
  }
}
