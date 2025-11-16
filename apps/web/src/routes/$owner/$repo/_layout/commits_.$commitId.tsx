import { generateDiffFile } from "@git-diff-view/file";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { CheckIcon, CopyIcon, FileIcon, GitCommitIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { getCommitQueryOptions } from "@/api/commits";
import { NotFoundComponent } from "@/components/404-components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLanguageFromFilename } from "@/lib/utils";
import "@git-diff-view/react/styles/diff-view-pure.css";

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
                  <span className="text-muted-foreground text-xs">
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
      <div className="flex items-center gap-4">
        <h2 className="font-semibold text-lg">
          {totalFilesChanged === 1
            ? "1 file changed"
            : `${totalFilesChanged} files changed`}
        </h2>
        <div className="flex items-center gap-2">
          {stats.filesAdded > 0 && (
            <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
              +{stats.filesAdded} added
            </Badge>
          )}
          {stats.filesModified > 0 && (
            <Badge className="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20">
              {stats.filesModified} modified
            </Badge>
          )}
          {stats.filesDeleted > 0 && (
            <Badge className="bg-red-500/10 text-red-600 hover:bg-red-500/20">
              -{stats.filesDeleted} deleted
            </Badge>
          )}
        </div>
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
          const filename = change.path.split("/").pop() || change.path;
          const language = getLanguageFromFilename(filename);
          const isBinary =
            (change.old?.isBinary ?? false) || (change.new?.isBinary ?? false);

          const typeBadges = {
            add: {
              className: "bg-green-500/10 text-green-600",
              label: "added",
            },
            remove: {
              className: "bg-red-500/10 text-red-600",
              label: "deleted",
            },
            modify: {
              className: "bg-yellow-500/10 text-yellow-600",
              label: "modified",
            },
          };

          return (
            <div
              className="overflow-hidden rounded-lg border"
              key={change.path}
            >
              {/* File Header */}
              <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <FileIcon className="size-4 text-muted-foreground" />
                  <span className="font-mono text-sm">{change.path}</span>

                  <Badge className={typeBadges[change.type].className}>
                    {typeBadges[change.type].label}
                  </Badge>
                </div>
              </div>

              {isBinary ? (
                <div className="flex flex-col items-center justify-center bg-muted/30 px-4 py-12 text-center">
                  <FileIcon className="mb-3 size-10 text-muted-foreground" />
                  <p className="font-medium text-sm">Binary file</p>
                  <p className="text-muted-foreground text-xs">
                    Binary files cannot be displayed
                  </p>
                </div>
              ) : (
                <Diff
                  language={language}
                  newContent={change.new?.content ?? null}
                  newPath={change.path}
                  oldContent={change.old?.content ?? null}
                  oldPath={change.path}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DiffProps = {
  oldPath: string | null;
  oldContent: string | null;
  newPath: string | null;
  newContent: string | null;
  language: string | null;
};

function Diff({
  oldPath,
  oldContent,
  newPath,
  newContent,
  language,
}: DiffProps) {
  const diffFile = useMemo(() => {
    const instance = generateDiffFile(
      oldPath ?? "",
      oldContent ?? "",
      newPath ?? "",
      newContent ?? "",
      language ?? "txt",
      language ?? "txt"
    );
    instance.initRaw();
    return instance;
  }, [oldPath, oldContent, newPath, newContent, language]);

  return (
    <DiffView
      diffFile={diffFile}
      diffViewFontSize={14}
      diffViewHighlight
      diffViewMode={DiffModeEnum.Unified}
      diffViewTheme="dark"
    />
  );
}
