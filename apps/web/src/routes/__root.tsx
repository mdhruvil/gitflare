import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import interUrl from "@fontsource-variable/inter/index.css?url";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { getSessionOptions } from "@/api/session";
import { NotFoundComponent } from "@/components/404-components";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import appCss from "../index.css?url";

export type RouterAppContext = {
  queryClient: QueryClient;
};

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
        title: "Gitflare",
      },
      {
        property: "og:title",
        content: "Gitflare",
      },
      {
        property: "og:description",
        content:
          "Gitflare is a fully open-source serverless git hosting platform. No VMs, No Containers, Just Durable Objects.",
      },
      {
        property: "og:image",
        content: "https://gitflare.mdhruvil.com/og.png",
      },
      {
        property: "og:url",
        content: "https://gitflare.mdhruvil.com",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        property: "twitter:card",
        content: "summary_large_image",
      },
      {
        property: "twitter:image",
        content: "https://gitflare.mdhruvil.com/og.png",
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
  loader: async ({ context: { queryClient } }) => {
    queryClient.prefetchQuery(getSessionOptions);
  },
  notFoundComponent: NotFoundComponent,
  component: RootDocument,
});

function RootDocument() {
  const isLoading = useRouterState({
    select: (s) => s.status === "pending",
  });

  const [canShowLoading, setShowLoading] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setShowLoading(true);
    }, 2000);

    return () => {
      clearTimeout(timeout);
    };
  }, []);

  return (
    <html className="dark" lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {canShowLoading && (
          <div
            className={cn(
              "-translate-y-full pointer-events-none fixed top-0 left-0 z-30 h-75 w-full opacity-0 backdrop-blur-md transition-all delay-0 duration-300 dark:h-50 dark:rounded-[100%] dark:bg-white/10!",
              isLoading && "-translate-y-[50%] opacity-100 delay-500"
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
                "-translate-x-1/2 absolute top-1/2 left-1/2 z-50 translate-y-7.5 rounded-lg bg-white/80 p-2 shadow-lg dark:bg-gray-700"
              }
            >
              <LoaderIcon className="animate-spin text-3xl" />
            </div>
          </div>
        )}
        <Outlet />
        <Toaster richColors />
        <TanStackRouterDevtools position="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
