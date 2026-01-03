import alchemy from "alchemy";
import {
  D1Database,
  DurableObjectNamespace,
  TanStackStart,
  Worker,
} from "alchemy/cloudflare";
import { GitHubComment } from "alchemy/github";
import { CloudflareStateStore } from "alchemy/state";

const PROD_DOMAIN = "gitflare.mdhruvil.com";

const LOCAL_URL = "http://localhost:3000";
const PROD_URL = `https://${PROD_DOMAIN}`;

const app = await alchemy("gitflare", {
  stateStore: (scope) => new CloudflareStateStore(scope),
});

const repoDO = DurableObjectNamespace("repos", {
  className: "Repo",
  sqlite: true,
});

const db = await D1Database("gitflare-db", {
  name: "gitflare-db",
  migrationsDir: "./migrations",
});

const isPreview = !!process.env.PULL_REQUEST;
const isProd = app.stage === "prod";

function getCurrentUrl() {
  if (isProd) {
    return PROD_URL;
  }
  if (isPreview) {
    return Worker.DevUrl;
  }
  return LOCAL_URL;
}

export const web = await TanStackStart("web", {
  bindings: {
    REPO: repoDO,
    DB: db,
    LOG_LEVEL: isProd ? "warn" : "debug",
    SITE_URL: getCurrentUrl(),
    VITE_BETTER_AUTH_URL: getCurrentUrl(),
    BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
  },
  domains: isProd ? [PROD_DOMAIN] : [],
});

if (process.env.PULL_REQUEST) {
  const previewUrl = web.url;

  await GitHubComment("pr-preview-comment", {
    owner: process.env.GITHUB_REPOSITORY_OWNER || "mdhruvil",
    repository: process.env.GITHUB_REPOSITORY_NAME || "gitvex",
    issueNumber: Number(process.env.PULL_REQUEST),
    body: `
## 🚀 Preview Deployed

Your preview is ready!

**Preview URL:** ${previewUrl}

This preview was built from commit ${process.env.GITHUB_SHA}

---
<sub>🤖 This comment will be updated automatically when you push new commits to this PR.</sub>`,
  });
}

await app.finalize();
