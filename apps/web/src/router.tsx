import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";
import "./index.css";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

export function getRouter() {
  const queryClient = new QueryClient();

  const router = createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration(opts) {
      const pathname = opts.location.pathname;

      // Disable scroll restoration for commit viewer pages
      if (/^\/[^/]+\/[^/]+\/commits\/[0-9a-f]{7,40}$/i.test(pathname)) {
        return false;
      }

      return true;
    },
    defaultPendingComponent: () => <Loader />,
    defaultNotFoundComponent: () => <div>Not Found</div>,
    context: { queryClient },
  });

  setupRouterSsrQueryIntegration({
    queryClient,
    router,
  });

  return router;
}

declare module "@tanstack/react-router" {
  // biome-ignore lint/style/useConsistentTypeDefinitions: it is what it is
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
