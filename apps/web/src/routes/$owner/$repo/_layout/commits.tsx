import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckIcon,
  CopyIcon,
  GitBranchIcon,
  GitCommitIcon,
} from "lucide-react";
import { useState } from "react";
import { getBranchesQueryOptions } from "@/api/branches";
import { getCommitsQueryOptions } from "@/api/commits";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAndThrowConvexError } from "@/lib/convex";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/$owner/$repo/_layout/commits")({
  component: RouteComponent,
  loader: async ({ params, context: { queryClient } }) => {
    await queryClient
      .ensureQueryData(
        getCommitsQueryOptions({
          owner: params.owner,
          repo: params.repo,
          ref: "main",
        })
      )
      .catch(handleAndThrowConvexError);
  },
  pendingComponent: CommitsPendingComponent,
});

function CommitsPendingComponent() {
  return (
    <div className="py-6">
      {/* Header with title and branch selector skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-semibold text-2xl">Commits</h1>
        <Skeleton className="h-9 w-[180px]" />
      </div>

      <div className="space-y-8">
        {/* Render 2 date groups */}
        {[1, 2].map((groupIndex) => (
          <div key={groupIndex}>
            {/* Date Header Skeleton */}
            <div className="mb-3">
              <Skeleton className="h-5 w-32" />
            </div>

            {/* Commits List Skeleton */}
            <div className="divide-y overflow-hidden rounded-lg border">
              {[1, 2, 3].map((commitIndex) => (
                <div className="flex items-start gap-3 p-4" key={commitIndex}>
                  {/* Commit Icon Skeleton */}
                  <div className="mt-1 shrink-0">
                    <Skeleton className="size-4 rounded-full" />
                  </div>

                  {/* Main Content Skeleton */}
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Commit Message Skeleton */}
                    <Skeleton className="h-5 w-3/4" />

                    {/* Author and Time Skeleton */}
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>

                  {/* Commit Hash and Actions Skeleton */}
                  <div className="flex shrink-0 items-center gap-2">
                    <Skeleton className="h-4 w-14" />
                    <Skeleton className="size-9" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return formatDistanceToNow(date, { addSuffix: true });
}

function formatCommitDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isThisYear = date.getFullYear() === now.getFullYear();

  return format(date, isThisYear ? "MMM d" : "MMM d, yyyy");
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <Button onClick={handleCopy} size="icon" variant="outline">
      {copied ? (
        <CheckIcon className="size-4 text-green-600" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </Button>
  );
}

function RouteComponent() {
  const params = Route.useParams();
  const { owner, repo } = params;
  const [selectedBranch, setSelectedBranch] = useState<string>("main");

  const { data } = useSuspenseQuery(
    getCommitsQueryOptions({
      owner,
      repo,
      ref: selectedBranch,
    })
  );

  type CommitType = (typeof data)[number];

  // Group commits by date
  const groupedCommits = data.reduce(
    (acc, commit) => {
      const dateKey = formatCommitDate(commit.commit.author.timestamp);
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(commit);
      return acc;
    },
    {} as Record<string, CommitType[]>
  );

  return (
    <div className="py-6">
      {/* Branch Selector */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-semibold text-2xl">Commits</h1>
        <BranchSelector
          onBranchChange={setSelectedBranch}
          owner={owner}
          repo={repo}
          selectedBranch={selectedBranch}
        />
      </div>

      <div className="space-y-8">
        {Object.entries(groupedCommits).map(([date, commits]) => (
          <div key={date}>
            {/* Date Header */}
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-semibold text-foreground text-sm">
                Commits on {date}
              </h2>
            </div>

            {/* Commits List */}
            <div className="divide-y overflow-hidden rounded-lg border">
              {commits.map((commit, index) => {
                const shortHash = commit.oid.substring(0, 7);
                const commitMessage = commit.commit.message.split("\n")[0];

                return (
                  <div
                    className={cn(
                      "group relative flex items-start gap-3 p-4 transition-colors hover:bg-muted/50",
                      index === 0 && "rounded-t-lg",
                      index === commits.length - 1 && "rounded-b-lg"
                    )}
                    key={commit.oid}
                  >
                    {/* Commit Icon */}
                    <div className="mt-1 shrink-0">
                      <GitCommitIcon className="size-4 text-muted-foreground" />
                    </div>

                    {/* Main Content */}
                    <div className="min-w-0 flex-1">
                      {/* Commit Message */}
                      <div className="mb-1">
                        <span className="font-semibold text-foreground">
                          {commitMessage}
                        </span>
                      </div>

                      {/* Author and Time */}
                      <div className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
                        <span className="font-medium">
                          {commit.commit.author.name}
                        </span>
                        <span>committed</span>
                        <span>
                          {formatRelativeTime(commit.commit.author.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Commit Hash and Actions */}
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs">{shortHash}</span>
                      <CopyButton text={commit.oid} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {data.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
            <GitCommitIcon className="mb-4 size-12 text-muted-foreground" />
            <h3 className="mb-2 font-semibold text-lg">No commits yet</h3>
            <p className="text-muted-foreground text-sm">
              This repository doesn&apos;t have any commits yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BranchSelector({
  owner,
  repo,
  selectedBranch,
  onBranchChange,
}: {
  owner: string;
  repo: string;
  selectedBranch: string;
  onBranchChange: (branch: string) => void;
}) {
  const { data: branches, isLoading } = useQuery(
    getBranchesQueryOptions({
      owner,
      repo,
    })
  );

  if (isLoading) {
    return <Skeleton className="h-9 w-[180px]" />;
  }

  return (
    <Select onValueChange={onBranchChange} value={selectedBranch}>
      <SelectTrigger className="w-[180px]">
        <div className="flex items-center gap-2">
          <GitBranchIcon className="size-4" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {branches?.map((branch) => (
          <SelectItem key={branch} value={branch}>
            {branch}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
