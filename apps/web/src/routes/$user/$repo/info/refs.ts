import { createFileRoute } from "@tanstack/react-router";
import { advertiseCapabilities } from "@/git/protocol";

export const Route = createFileRoute("/$user/$repo/info/refs")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const service = url.searchParams.get("service");

        if (service === "git-upload-pack" || service === "git-receive-pack") {
          const { repo, user } = params;
          const fullRepoName = `${user}/${repo}`;

          return advertiseCapabilities(service, fullRepoName);
        }

        return new Response("Missing or invalid service", { status: 400 });
      },
    },
  },
});
