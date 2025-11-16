import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import {
  BookOpenIcon,
  FolderGitIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LockIcon,
  PlusIcon,
} from "lucide-react";
import { getSessionOptions } from "@/api/session";
import { NotFoundComponent } from "@/components/404-components";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAndThrowConvexError } from "@/lib/convex";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/dashboard")({
  component: RouteComponent,
  notFoundComponent: NotFoundComponent,
  loader: async ({ context: { queryClient } }) => {
    const session = await queryClient.ensureQueryData(getSessionOptions);
    const username = session?.user?.username;

    if (!username) {
      return;
    }

    await Promise.all([
      queryClient
        .ensureQueryData(
          convexQuery(api.repositories.getByOwner, { owner: username })
        )
        .catch(handleAndThrowConvexError),
      queryClient
        .ensureQueryData(convexQuery(api.repositories.getMyStats, {}))
        .catch(handleAndThrowConvexError),
      queryClient
        .ensureQueryData(convexQuery(api.issues.getMyIssues, { limit: 5 }))
        .catch(handleAndThrowConvexError),
      queryClient
        .ensureQueryData(convexQuery(api.pulls.getMyPullRequests, { limit: 5 }))
        .catch(handleAndThrowConvexError),
    ]);
  },
  pendingComponent: DashboardSkeleton,
});

function RouteComponent() {
  const { data: session } = useSuspenseQuery(getSessionOptions);
  const user = session?.user;
  const username = user?.username ?? "";

  const { data: repositoriesData } = useSuspenseQuery(
    convexQuery(api.repositories.getByOwner, { owner: username })
  );

  const { data: stats } = useSuspenseQuery(
    convexQuery(api.repositories.getMyStats, {})
  );

  const { data: recentIssues } = useSuspenseQuery(
    convexQuery(api.issues.getMyIssues, { limit: 5 })
  );

  const { data: recentPRs } = useSuspenseQuery(
    convexQuery(api.pulls.getMyPullRequests, { limit: 5 })
  );

  if (!user?.username) {
    return <Navigate to="/login" />;
  }

  const repositories = repositoriesData.repos;
  return (
    <div className="py-8">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarImage
                alt={`@${user.username}`}
                src={`https://api.dicebear.com/9.x/notionists/svg?seed=${user.username}&scale=150&backgroundType=solid,gradientLinear&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`}
              />
              <AvatarFallback>
                {user.name
                  ?.split(" ")
                  .map((w) => w.at(0))
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-bold text-2xl">{user.name}</h1>
              <p className="text-muted-foreground">@{user.username}</p>
            </div>
          </div>
          <Link to="/new">
            <Button>
              <PlusIcon className="size-4" />
              New Repository
            </Button>
          </Link>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="font-medium text-sm">
                Repositories
              </CardTitle>
              <FolderGitIcon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">{stats.totalRepos}</div>
              <p className="text-muted-foreground text-xs">
                Total repositories
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="font-medium text-sm">Open Issues</CardTitle>
              <BookOpenIcon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">{stats.openIssues}</div>
              <p className="text-muted-foreground text-xs">
                Issues you created
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="font-medium text-sm">
                Open Pull Requests
              </CardTitle>
              <GitPullRequestIcon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">{stats.openPRs}</div>
              <p className="text-muted-foreground text-xs">
                Pull requests you created
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Repositories Section */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-xl">Your Repositories</h2>
            {repositories.length > 0 && (
              <Link params={{ owner: user.username }} to="/$owner">
                <Button size="sm" variant="ghost">
                  View all
                </Button>
              </Link>
            )}
          </div>
          {repositories.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FolderGitIcon className="mb-4 size-12 text-muted-foreground" />
                <h3 className="mb-2 font-semibold text-lg">
                  No repositories yet
                </h3>
                <p className="mb-4 text-center text-muted-foreground text-sm">
                  Get started by creating your first repository
                </p>
                <Link to="/new">
                  <Button>
                    <PlusIcon className="size-4" />
                    Create Repository
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {repositories.slice(0, 6).map((repo) => (
                <Link
                  className="h-full"
                  key={repo._id}
                  params={{ owner: repo.owner, repo: repo.name }}
                  to="/$owner/$repo"
                >
                  <Card className="h-full transition-colors hover:bg-accent">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <GitBranchIcon className="size-4 text-muted-foreground" />
                          <CardTitle className="text-base">
                            {repo.name}
                          </CardTitle>
                        </div>
                        {repo.isPrivate && (
                          <LockIcon className="size-4 text-muted-foreground" />
                        )}
                      </div>
                      {repo.description && (
                        <CardDescription className="line-clamp-2 text-sm">
                          {repo.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity Section */}
        {(recentIssues.length > 0 || recentPRs.length > 0) && (
          <div className="grid gap-8 md:grid-cols-2">
            {/* Recent Issues */}
            <div>
              <h2 className="mb-4 font-semibold text-xl">Recent Issues</h2>
              {recentIssues.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    No issues created yet
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-clip p-0">
                  <CardContent className="p-0">
                    {recentIssues.map((issue, index) => (
                      <div key={issue._id}>
                        <Link
                          className="block p-4 transition-colors hover:bg-accent"
                          params={{
                            owner: issue.fullName.split("/")[0],
                            repo: issue.fullName.split("/")[1],
                            issueNumber: issue.number.toString(),
                          }}
                          to="/$owner/$repo/issues/$issueNumber"
                        >
                          <div className="flex items-start gap-3">
                            <BookOpenIcon
                              className={cn(
                                "mt-1 size-4 shrink-0",
                                issue.status === "open"
                                  ? "text-green-600"
                                  : "text-purple-600"
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm">
                                {issue.title}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {issue.fullName} #{issue.number}
                              </p>
                            </div>
                            <Badge
                              variant={
                                issue.status === "open"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {issue.status}
                            </Badge>
                          </div>
                        </Link>
                        {index < recentIssues.length - 1 && <Separator />}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Recent Pull Requests */}
            <div>
              <h2 className="mb-4 font-semibold text-xl">
                Recent Pull Requests
              </h2>
              {recentPRs.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    No pull requests created yet
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    {recentPRs.map((pr, index) => (
                      <div key={pr._id}>
                        <Link
                          className="block p-4 transition-colors hover:bg-accent"
                          params={{
                            owner: pr.fullName.split("/")[0],
                            repo: pr.fullName.split("/")[1],
                          }}
                          to="/$owner/$repo/pulls"
                        >
                          <div className="flex items-start gap-3">
                            <GitPullRequestIcon
                              className={cn(
                                "mt-1 size-4 shrink-0",
                                pr.status === "open" && "text-green-600",
                                pr.status === "merged" && "text-purple-600",
                                pr.status === "closed" && "text-red-600"
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm">{pr.title}</p>
                              <p className="text-muted-foreground text-xs">
                                {pr.fullName} #{pr.number}
                              </p>
                            </div>
                            <Badge
                              variant={
                                pr.status === "closed" ? "secondary" : "default"
                              }
                            >
                              {pr.status}
                            </Badge>
                          </div>
                        </Link>
                        {index < recentPRs.length - 1 && <Separator />}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="py-8">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <Skeleton className="h-10 w-40" />
        </div>

        {/* Stats Skeleton */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="mb-2 h-8 w-12" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="mb-2 h-8 w-12" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="mb-2 h-8 w-12" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        </div>

        {/* Repositories Skeleton */}
        <div>
          <Skeleton className="mb-4 h-6 w-48" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
