import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { CheckIcon, CopyIcon, FileIcon, GitCommitIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { getCommitQueryOptions } from "@/api/commits";
import { NotFoundComponent } from "@/components/404-components";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { diffOptionsWithHeader, diffsStyleVariables } from "@/lib/diffs-config";

const LazyMultiFileDiff = lazy(() =>
  import("@pierre/diffs/react").then((m) => ({ default: m.MultiFileDiff }))
);

export const Route = createFileRoute(
  "/$owner/$repo/_layout/commits_/$commitId"
)({
  component: RouteComponent,
  notFoundComponent: NotFoundComponent,
  loader: async ({ params, context: { queryClient } }) => {
    const { owner, repo, commitId } = params;
    await queryClient.ensureQueryData(
      getCommitQueryOptions({
        owner,
        repo,
        commitOid: commitId,
      })
    );
  },
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button className="size-7" onClick={handleCopy} size="icon" variant="ghost">
      {copied ? (
        <CheckIcon className="size-3" />
      ) : (
        <CopyIcon className="size-3" />
      )}
    </Button>
  );
}

function RouteComponent() {
  const params = Route.useParams();
  const { owner, repo, commitId } = params;

  const { data } = useSuspenseQuery(
    getCommitQueryOptions({
      owner,
      repo,
      commitOid: commitId,
    })
  );

  const commit = data.commit?.commit;
  const changes = data.changes;

  if (!commit) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <GitCommitIcon className="mx-auto mb-4 size-12 text-muted-foreground" />
          <h3 className="mb-2 font-semibold text-lg">Commit not found</h3>
          <p className="text-muted-foreground text-sm">
            The requested commit could not be found.
          </p>
        </div>
      </div>
    );
  }

  const shortHash = commitId.substring(0, 7);
  const fullHash = commitId;
  const messageLines = commit.message.split("\n");
  const title = messageLines[0];
  const description = messageLines.slice(1).join("\n").trim();

  // Calculate stats
  const stats = changes.reduce(
    (acc, change) => {
      if (change.type === "add") {
        acc.filesAdded += 1;
      } else if (change.type === "remove") {
        acc.filesDeleted += 1;
      } else if (change.type === "modify") {
        acc.filesModified += 1;
      }
      return acc;
    },
    { filesAdded: 0, filesDeleted: 0, filesModified: 0 }
  );

  const totalFilesChanged =
    stats.filesAdded + stats.filesDeleted + stats.filesModified;

  return (
    <div className="space-y-6">
      {/* Commit Header Card */}
      <Card>
        <CardContent className="space-y-4">
          {/* Author Info */}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  {commit.author.name}
                </span>
                {commit.author.email && (
                  <span className="font-mono text-muted-foreground text-xs">
                    &lt;{commit.author.email}&gt;
                  </span>
                )}
              </div>
              <div className="text-muted-foreground text-xs">
                authored{" "}
                {format(
                  new Date(commit.author.timestamp * 1000),
                  "MMM d, yyyy 'at' h:mm a"
                )}
              </div>
            </div>
            <div className="flex gap-5 text-xs">
              {commit.parent && commit.parent.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Parent</span>
                  <Link
                    className="rounded bg-muted px-2 py-0.5 font-mono transition-colors hover:bg-muted/80"
                    params={{ owner, repo, commitId: commit.parent[0] }}
                    to="/$owner/$repo/commits/$commitId"
                  >
                    {commit.parent[0].substring(0, 7)}
                  </Link>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Commit</span>
                <code className="rounded bg-muted px-2 py-0.5 font-mono">
                  {shortHash}
                </code>
                <CopyButton text={fullHash} />
              </div>
            </div>
          </div>

          {/* Commit Title */}
          <div>
            <h1 className="font-semibold text-lg">{title}</h1>
            {description && (
              <pre className="mt-3 whitespace-pre-wrap font-sans text-muted-foreground text-sm">
                {description}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      {/* File Changes Summary */}
      <div className="flex items-center gap-3 font-mono text-sm">
        <span className="font-semibold">
          {totalFilesChanged === 1
            ? "1 file changed"
            : `${totalFilesChanged} files changed`}
        </span>
        {stats.filesAdded > 0 && (
          <span className="text-green-500">
            +{stats.filesAdded} {stats.filesAdded === 1 ? "file" : "files"}{" "}
            added
          </span>
        )}
        {stats.filesModified > 0 && (
          <span className="text-yellow-500">
            ~{stats.filesModified}{" "}
            {stats.filesModified === 1 ? "file" : "files"} modified
          </span>
        )}
        {stats.filesDeleted > 0 && (
          <span className="text-red-500">
            -{stats.filesDeleted} {stats.filesDeleted === 1 ? "file" : "files"}{" "}
            deleted
          </span>
        )}
      </div>

      {/* File Changes */}
      <div className="space-y-6">
        {changes.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <FileIcon className="mb-4 size-12 text-muted-foreground" />
              <h3 className="mb-2 font-semibold text-lg">No changes</h3>
              <p className="text-muted-foreground text-sm">
                This commit doesn&apos;t contain any file changes.
              </p>
            </CardContent>
          </Card>
        )}

        {changes.map((change) => {
          const isBinary =
            (change.old?.isBinary ?? false) || (change.new?.isBinary ?? false);

          if (isBinary) {
            return (
              <div
                className="overflow-hidden rounded-lg border"
                key={change.path}
              >
                <div className="flex items-center border-b bg-muted/50 px-4 py-3">
                  <span className="font-mono text-sm">{change.path}</span>
                </div>
                <div className="flex flex-col items-center justify-center bg-muted/30 px-4 py-12 text-center">
                  <FileIcon className="mb-3 size-10 text-muted-foreground" />
                  <p className="font-medium text-sm">Binary file</p>
                  <p className="text-muted-foreground text-xs">
                    Binary files cannot be displayed
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div
              className="overflow-hidden rounded-lg"
              key={change.path}
              style={diffsStyleVariables}
            >
              <Suspense
                fallback={
                  <div className="p-4 text-muted-foreground text-sm">
                    Loading diff...
                  </div>
                }
              >
                <LazyMultiFileDiff
                  newFile={{
                    name: change.path,
                    contents: change.new?.content ?? "",
                  }}
                  oldFile={{
                    name: change.path,
                    contents: change.old?.content ?? "",
                  }}
                  options={diffOptionsWithHeader}
                />
              </Suspense>
            </div>
          );
        })}
      </div>
    </div>
  );
}
