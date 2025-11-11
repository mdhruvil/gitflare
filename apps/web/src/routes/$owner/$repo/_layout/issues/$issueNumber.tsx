import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import type { Id } from "@gitvex/backend/convex/_generated/dataModel";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { CircleCheckIcon, CircleDotIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchMutation } from "@/lib/auth-server";
import { handleAndThrowConvexError } from "@/lib/convex";
import { cn } from "@/lib/utils";

const getIssueQueryOptions = (owner: string, repo: string, number: number) =>
  convexQuery(api.issues.getByRepoAndNumber, {
    fullName: `${owner}/${repo}`,
    number,
  });

const addCommentSchema = z.object({
  issueId: z.custom<Id<"issues">>(),
  body: z.string().min(1, "Comment cannot be empty"),
});

const addCommentServerFn = createServerFn({ method: "POST" })
  .inputValidator(addCommentSchema)
  .handler(async ({ data }) => {
    const commentId = await fetchMutation(api.comments.addComment, {
      issueId: data.issueId,
      body: data.body,
    }).catch(handleAndThrowConvexError);

    return commentId;
  });

const updateIssueStatusSchema = z.object({
  issueId: z.custom<Id<"issues">>(),
  status: z.enum(["open", "closed"]),
});

const updateIssueStatusServerFn = createServerFn({ method: "POST" })
  .inputValidator(updateIssueStatusSchema)
  .handler(async ({ data }) => {
    await fetchMutation(api.issues.update, {
      id: data.issueId,
      status: data.status,
    }).catch(handleAndThrowConvexError);

    return null;
  });

export const Route = createFileRoute(
  "/$owner/$repo/_layout/issues/$issueNumber"
)({
  component: RouteComponent,
  loader: async ({ params, context: { queryClient } }) => {
    await queryClient
      .ensureQueryData(
        getIssueQueryOptions(
          params.owner,
          params.repo,
          Number(params.issueNumber)
        )
      )
      .catch(handleAndThrowConvexError);
  },
});

function RouteComponent() {
  const params = Route.useParams();
  const { data: issue } = useSuspenseQuery(
    getIssueQueryOptions(params.owner, params.repo, Number(params.issueNumber))
  );
  const [commentBody, setCommentBody] = useState("");

  const addCommentMutation = useMutation({
    mutationFn: async (body: string) =>
      await addCommentServerFn({
        data: {
          issueId: issue._id,
          body,
        },
      }),
    onSuccess: () => {
      setCommentBody("");
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add comment";
      toast.error(errorMessage);
    },
  });

  const updateIssueStatusMutation = useMutation({
    mutationFn: async (status: "open" | "closed") =>
      await updateIssueStatusServerFn({
        data: {
          issueId: issue._id,
          status,
        },
      }),

    onError: (err) => {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to update issue status";
      toast.error(errorMessage);
    },
  });

  const handleSubmitComment = () => {
    if (!commentBody.trim()) {
      return;
    }

    addCommentMutation.mutate(commentBody);
  };

  const handleCancel = () => {
    setCommentBody("");
  };

  const handleToggleStatus = () => {
    const newStatus = issue.status === "open" ? "closed" : "open";
    updateIssueStatusMutation.mutate(newStatus);
  };

  const isSubmitting = addCommentMutation.isPending;

  const statusLabel = issue.status === "open" ? "Open" : "Closed";

  const issueIconMap = {
    open: CircleDotIcon,
    closed: CircleCheckIcon,
  };

  const CurrentStatusIcon = issueIconMap[issue.status];
  const InverseStatusIcon =
    issue.status === "open" ? issueIconMap.closed : issueIconMap.open;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="font-semibold text-2xl leading-tight">{issue.title}</h1>
        <Badge
          className={cn("text-primary", {
            "bg-green-700": issue.status === "open",
            "bg-purple-600": issue.status === "closed",
          })}
        >
          <CurrentStatusIcon className="size-4" />
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
        <h3 className="font-semibold text-sm">
          Comments ({issue.comments.length})
        </h3>
        {issue.comments.length > 0 ? (
          <div className="space-y-4">
            {issue.comments.map((comment) => (
              <Comment
                _creationTime={comment._creationTime}
                content={comment.body}
                creatorUsername={comment.authorUsername}
                key={comment._id}
                type="comment"
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed py-8">
            <p className="text-muted-foreground text-sm">
              No comments yet. Be the first to comment!
            </p>
          </div>
        )}

        {/* Add Comment */}
        <div className="space-y-3">
          <Textarea
            className="resize-none"
            disabled={isSubmitting}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Add a comment..."
            rows={4}
            value={commentBody}
          />
          <div className="flex items-center justify-between gap-2">
            {issue.canUpdate && (
              <Button
                loading={updateIssueStatusMutation.isPending}
                onClick={handleToggleStatus}
                variant="outline"
              >
                <InverseStatusIcon
                  className={cn("size-4", {
                    "text-purple-400": issue.status === "open",
                    "text-green-500": issue.status === "closed",
                  })}
                />
                {issue.status === "open" ? "Close issue" : "Reopen issue"}
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                disabled={isSubmitting || !commentBody.trim()}
                onClick={handleCancel}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                loading={isSubmitting}
                onClick={handleSubmitComment}
                type="button"
              >
                Comment
              </Button>
            </div>
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
