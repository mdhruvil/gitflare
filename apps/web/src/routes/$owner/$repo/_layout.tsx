import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import {
  CircleDotIcon,
  CodeIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  SettingsIcon,
} from "lucide-react";
import { getBranchesQueryOptions } from "@/api/branches";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/$owner/$repo/_layout")({
  component: RouteComponent,
  loader: async ({ params, context: { queryClient } }) => {
    queryClient.prefetchQuery(
      getBranchesQueryOptions({
        owner: params.owner,
        repo: params.repo,
      })
    );
    await queryClient.ensureQueryData(
      convexQuery(api.repositories.getByOwnerAndName, {
        owner: params.owner,
        name: params.repo,
      })
    );
  },
});

function RouteComponent() {
  const params = Route.useParams();
  const { owner, repo } = params;
  const pathname = useLocation({
    select: (state) => state.pathname,
  });

  // Map route patterns to tab values
  const getActiveTab = (path: string): string => {
    const basePath = `/${owner}/${repo}`;

    // Remove base path to get the relative route
    const relativePath = path.startsWith(basePath)
      ? path.slice(basePath.length)
      : path;

    // Match routes to tabs
    if (relativePath === "" || relativePath === "/") {
      return "code";
    }
    if (relativePath.startsWith("/tree") || relativePath.startsWith("/blob")) {
      return "code";
    }
    if (relativePath.startsWith("/commits")) {
      return "commits";
    }
    if (relativePath.startsWith("/issues")) {
      return "issues";
    }
    if (relativePath.startsWith("/pulls")) {
      return "pulls";
    }
    if (relativePath.startsWith("/settings")) {
      return "settings";
    }

    // Default to code tab
    return "code";
  };

  const activeTab = getActiveTab(pathname);

  return (
    <div className="my-5">
      <div className="border-b">
        <nav className="mx-auto max-w-5xl space-y-3">
          <div className="flex items-center gap-4">
            <Link className="ml-3" to="/">
              <GitBranchIcon className="size-5" />
            </Link>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link
                      className="text-primary"
                      params={{
                        owner,
                      }}
                      to="/$owner"
                    >
                      {owner}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator>/</BreadcrumbSeparator>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link
                      className="font-semibold text-primary"
                      params={{
                        owner,
                        repo,
                      }}
                      to="/$owner/$repo"
                    >
                      {repo}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div>
            <Tabs
              defaultValue={activeTab ?? "code"}
              onChange={() => {}}
              value={activeTab ?? "code"}
            >
              <TabsList>
                <TabsTrigger asChild value="code">
                  <Link params={params} to="/$owner/$repo">
                    <CodeIcon className="opacity-60" />
                    Code
                  </Link>
                </TabsTrigger>
                <TabsTrigger asChild value="commits">
                  <Link params={params} to="/$owner/$repo/commits">
                    <GitCommitHorizontalIcon className="opacity-60" />
                    Commits
                  </Link>
                </TabsTrigger>
                <TabsTrigger asChild value="issues">
                  <Link params={params} to="/$owner/$repo/issues">
                    <CircleDotIcon className="opacity-60" />
                    Issues
                  </Link>
                </TabsTrigger>
                <TabsTrigger asChild value="pulls">
                  <Link params={params} to="/$owner/$repo/pulls">
                    <GitPullRequestIcon className="opacity-60" />
                    Pull Requests
                  </Link>
                </TabsTrigger>
                <TabsTrigger asChild value="settings">
                  <Link params={params} to="/$owner/$repo/settings">
                    <SettingsIcon className="opacity-60" />
                    Settings
                  </Link>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </nav>
      </div>
      <section className="mx-auto my-8 max-w-5xl">
        <Outlet />
      </section>
    </div>
  );
}
