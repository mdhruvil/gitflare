import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAndThrowConvexError } from "@/lib/convex";

const getIssuesQueryOptions = (owner: string, repo: string) =>
  convexQuery(api.issues.getByRepo, {
    fullName: `${owner}/${repo}`,
  });

export const Route = createFileRoute("/$owner/$repo/_layout/issues/")({
  component: RouteComponent,
  loader: async ({ params, context: { queryClient } }) => {
    await queryClient
      .ensureQueryData(getIssuesQueryOptions(params.owner, params.repo))
      .catch(handleAndThrowConvexError);
  },
  pendingComponent: PendingComponent,
});

function RouteComponent() {
  const params = Route.useParams();
  const { data: issues } = useSuspenseQuery(
    getIssuesQueryOptions(params.owner, params.repo)
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between pb-4">
        <h2 className="font-semibold text-xl">Issues</h2>
        <Link
          className={buttonVariants({ size: "sm" })}
          params={params}
          to="/$owner/$repo/issues/new"
        >
          New Issue
        </Link>
      </div>

      {issues.length === 0 && (
        <div className="space-y-4 rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            No issues found for this repository.
          </p>
          <Link
            className={buttonVariants()}
            params={params}
            to="/$owner/$repo/issues/new"
          >
            Create Issue
          </Link>
        </div>
      )}

      <div className="divide-y overflow-hidden rounded-lg border">
        {issues.map((issue) => (
          <Link
            className="block px-4 py-4 transition-colors hover:bg-muted/50"
            key={issue._id}
            params={{ ...params, issueNumber: issue.number.toString() }}
            to="/$owner/$repo/issues/$issueNumber"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h3 className="font-semibold text-base leading-tight">
                    {issue.title}
                  </h3>
                </div>
                <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
                  <span>#{issue.number}</span>
                  <span>•</span>
                  <span>
                    {issue.creatorUsername} opened{" "}
                    {formatDistanceToNow(new Date(issue._creationTime), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PendingComponent() {
  const params = Route.useParams();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between pb-4">
        <h2 className="font-semibold text-xl">Issues</h2>
        <Link
          className={buttonVariants({ size: "sm" })}
          params={params}
          to="/$owner/$repo/issues/new"
        >
          New Issue
        </Link>
      </div>

      <div className="divide-y overflow-hidden rounded-lg border">
        {Array.from({ length: 5 }, (_, i) => `skeleton-${i}`).map((id) => (
          <div className="block px-4 py-4" key={id}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <Skeleton className="h-5 w-3/4" />
                </div>
                <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
