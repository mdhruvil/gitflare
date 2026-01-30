import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$owner/$repo/git-upload-pack")({
  server: {
    handlers: {
      POST: async () => {
        // TODO: Implement upload-pack (git fetch/clone) in HybridRepo DO
        return new Response("upload-pack not yet implemented", { status: 501 });
      },
    },
  },
});
