import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";
import "./index.css";

export function getRouter() {
  const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;
  if (!CONVEX_URL) {
    throw new Error("VITE_CONVEX_URL is not defined");
  }
  const convex = new ConvexReactClient(CONVEX_URL, {
    unsavedChangesWarning: false,
  });

  const convexQueryClient = new ConvexQueryClient(convex);

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  });
  convexQueryClient.connect(queryClient);

  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      defaultPreload: "intent",
      defaultPendingComponent: () => <Loader />,
      defaultNotFoundComponent: () => <div>Not Found</div>,
      context: { queryClient, convexClient: convex, convexQueryClient },
      Wrap: ({ children }) => (
        <ConvexProvider client={convexQueryClient.convexClient}>
          {children}
        </ConvexProvider>
      ),
    }),
    queryClient
  );
  return router;
}

declare module "@tanstack/react-router" {
  // biome-ignore lint/style/useConsistentTypeDefinitions: it is what it is
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
