import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const getIssueQueryOptions = (owner: string, repo: string, number: number) =>
  convexQuery(api.issues.getByRepoAndNumber, {
    fullName: `${owner}/${repo}`,
    number,
  });

export const Route = createFileRoute(
  "/$owner/$repo/_layout/issues/$issueNumber"
)({
  component: RouteComponent,
  loader: async ({ params, context: { queryClient } }) => {
    await queryClient.ensureQueryData(
      getIssueQueryOptions(
        params.owner,
        params.repo,
        Number(params.issueNumber)
      )
    );
  },
});

function RouteComponent() {
  const params = Route.useParams();
  const { data: issue } = useSuspenseQuery(
    getIssueQueryOptions(params.owner, params.repo, Number(params.issueNumber))
  );

  const statusLabel = issue.status === "open" ? "Open" : "Closed";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="font-semibold text-2xl leading-tight">{issue.title}</h1>
        <Badge
          className={cn("text-primary", {
            "bg-green-700": issue.status === "open",
            "bg-red-700": issue.status === "closed",
          })}
        >
          {statusLabel}
        </Badge>
      </div>

      {/* Main Content */}
      <div className="space-y-4">
        {/* Original Comment */}
        <Comment
          _creationTime={issue._creationTime}
          content={issue.body}
          creatorUsername={issue.creatorUsername}
          type="description"
        />

        {/* Comments Section */}
        <h3 className="font-semibold text-sm">Comments</h3>
        <div className="flex items-center justify-center rounded-lg border border-dashed py-8">
          <p className="text-muted-foreground text-sm">TODO</p>
        </div>

        {/* Add Comment */}
        <div className="space-y-3">
          <Textarea
            className="resize-none"
            placeholder="Add a comment..."
            rows={4}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline">Cancel</Button>
            <Button type="button">Comment</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

type CommentProp = {
  type: "description" | "comment";
  content: string | undefined;
  creatorUsername: string;
  _creationTime: number;
};

export function Comment({
  type = "comment",
  content,
  creatorUsername,
  _creationTime,
}: CommentProp) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <p className="font-semibold text-sm">{creatorUsername}</p>
        <p className="text-muted-foreground text-xs">
          {type === "description" ? "created" : "commented"}{" "}
          {formatDistanceToNow(new Date(_creationTime), {
            addSuffix: true,
          })}
        </p>
      </div>

      <div className="prose prose-sm dark:prose-invert bg-background px-3 py-2">
        {content ?? "No content provided"}
      </div>
    </div>
  );
}
