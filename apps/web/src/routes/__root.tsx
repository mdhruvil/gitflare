import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { getCookieName } from "@convex-dev/better-auth/react-start";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import interUrl from "@fontsource-variable/inter/index.css?url";
import { createAuth } from "@gitvex/backend/convex/auth";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  HeadContent,
  Outlet,
  Scripts,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { AlertCircleIcon, LoaderIcon } from "lucide-react";
import { getSessionOptions } from "@/api/session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Toaster } from "@/components/ui/sonner";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import appCss from "../index.css?url";

export type RouterAppContext = {
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
  convexQueryClient: ConvexQueryClient;
};

const fetchAuth = createServerFn({ method: "GET" }).handler(async () => {
  const sessionCookieName = getCookieName(createAuth);
  const token = getCookie(sessionCookieName);
  return { token };
});

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "GitVex",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "stylesheet",
        href: interUrl,
      },
      {
        rel: "preload",
        as: "font",
        href: interWoff2,
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "icon",
        href: "/logo.svg",
        type: "image/svg+xml",
      },
    ],
  }),
  beforeLoad: async ({ context }) => {
    const { token } = await fetchAuth();
    if (token) {
      context.convexQueryClient.serverHttpClient?.setAuth(token);
    }
    return { token };
  },
  loader: async ({ context: { queryClient } }) => {
    queryClient.prefetchQuery(getSessionOptions);
  },
  component: RootDocument,
  errorComponent: ErrorComponent,
});

function ErrorComponent({ error }: ErrorComponentProps) {
  let errorMessage = error.message;
  if (
    error instanceof ConvexError &&
    error.data &&
    typeof error.data === "string"
  ) {
    errorMessage = error.data;
  }
  return (
    <div className="p-4">
      <Alert className="mb-6" variant="destructive">
        <AlertCircleIcon className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    </div>
  );
}

function RootDocument() {
  const context = useRouteContext({ from: Route.id });
  const isLoading = useRouterState({
    select: (s) => s.status === "pending",
  });

  return (
    <ConvexBetterAuthProvider
      authClient={authClient}
      client={context.convexClient}
    >
      <html className="dark" lang="en">
        <head>
          <HeadContent />
        </head>
        <body>
          <div
            className={cn(
              "-translate-y-full pointer-events-none fixed top-0 left-0 z-30 h-[300px] w-full opacity-0 backdrop-blur-md transition-all delay-0 duration-300 dark:h-[200px] dark:rounded-[100%] dark:bg-white/10!",
              isLoading && "-translate-y-[50%] opacity-100 delay-200"
            )}
            style={{
              background:
                "radial-gradient(closest-side, rgba(0,10,40,0.2) 0%, rgba(0,0,0,0) 100%)",
              maskImage:
                "radial-gradient(ellipse 70% 75% at 50% 40%, black 60%, transparent 80%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 70% 75% at 50% 40%, black 60%, transparent 80%)",
            }}
          >
            <div
              className={
                "-translate-x-1/2 absolute top-1/2 left-1/2 z-50 translate-y-[30px] rounded-lg bg-white/80 p-2 shadow-lg dark:bg-gray-700"
              }
            >
              <LoaderIcon className="animate-spin text-3xl" />
            </div>
          </div>
          <Outlet />
          <Toaster richColors />
          <TanStackRouterDevtools position="bottom-left" />
          <Scripts />
        </body>
      </html>
    </ConvexBetterAuthProvider>
  );
}
