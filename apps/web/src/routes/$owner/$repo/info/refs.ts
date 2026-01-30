import { createFileRoute } from "@tanstack/react-router";
import { getHybridRepoDOStub } from "@/do/hybrid-repo";

export const Route = createFileRoute("/$owner/$repo/info/refs")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const service = url.searchParams.get("service");

        if (service !== "git-upload-pack" && service !== "git-receive-pack") {
          return new Response("Missing or invalid service", { status: 400 });
        }

        const { repo, owner } = params;
        const repoName = repo.endsWith(".git") ? repo.slice(0, -4) : repo;

        // // Verify authentication (allows anonymous for public repos on read)
        // const isAuthorized = await verifyAuth({
        //   owner,
        //   repo: repoName,
        //   req: request,
        //   service:
        //     service === "git-upload-pack" ? "upload-pack" : "receive-pack",
        // });

        // if (!isAuthorized) {
        //   return new Response("Unauthorized", {
        //     status: 401,
        //     headers: {
        //       "WWW-Authenticate": 'Basic realm="Git"',
        //     },
        //   });
        // }

        const stub = getHybridRepoDOStub(`${owner}/${repoName}`);
        return stub.fetch(`https://do/info/refs?service=${service}`);
      },
    },
  },
});
