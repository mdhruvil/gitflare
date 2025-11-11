import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { BookOpenIcon, FileIcon, FolderIcon, TerminalIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { getBlobQueryOptions, getTreeQueryOptions } from "@/api/tree";
import { components } from "@/components/md-components";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAndThrowConvexError } from "@/lib/convex";

const searchSchema = z.object({
  ref: z.string().optional().default("main"),
});

export const Route = createFileRoute("/$owner/$repo/_layout/")({
  component: RouteComponent,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    ref: search.ref,
  }),
  loader: async ({ params, context: { queryClient }, deps, location }) => {
    await queryClient
      .ensureQueryData(
        getTreeQueryOptions({
          owner: params.owner,
          repo: params.repo,
          ref: deps.ref,
          path: "",
        })
      )
      .catch(handleAndThrowConvexError);

    return {
      url: location.url,
    };
  },
  pendingComponent: IndexPendingComponent,
});

function IndexPendingComponent() {
  return (
    <div className="py-6">
      <div className="divide-y overflow-hidden rounded-lg border">
        {[1, 2, 3, 4, 5].map((i) => (
          <div className="flex items-center gap-3 p-3" key={i}>
            <Skeleton className="size-4" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RouteComponent() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const { owner, repo } = params;
  const { ref = "main" } = search;

  const { data: tree } = useSuspenseQuery(
    getTreeQueryOptions({
      owner,
      repo,
      ref,
      path: "",
    })
  );

  // If tree is empty, show instructions
  if (tree.length === 0) {
    return <EmptyRepositoryInstructions owner={owner} repo={repo} />;
  }

  // Sort tree: directories first, then files
  const sortedTree = [...tree].sort((a, b) => {
    const aIsDir = a.type === "tree";
    const bIsDir = b.type === "tree";

    if (aIsDir !== bIsDir) {
      return aIsDir ? -1 : 1;
    }

    return a.path.localeCompare(b.path);
  });

  // Find README file (case-insensitive)
  const readmeEntry = tree.find((entry) =>
    /^readme(\.(md|mdx|markdown|txt))?$/i.test(entry.path)
  );

  return (
    <div className="space-y-6 py-6">
      <div className="divide-y overflow-hidden rounded-lg border">
        {sortedTree.map((entry) => {
          const isDirectory = entry.type === "tree";
          const newPath = entry.path;

          return (
            <Link
              className="grid grid-cols-[300px_minmax(0,1fr)_auto] items-center gap-4 p-3 transition-colors hover:bg-muted/50"
              key={entry.oid}
              params={{ owner, repo }}
              search={{
                ref,
                path: newPath,
              }}
              to={isDirectory ? "/$owner/$repo/tree" : "/$owner/$repo/blob"}
            >
              {/* Left: File/Directory Name */}
              <div className="flex min-w-0 items-center gap-3">
                {isDirectory ? (
                  <FolderIcon className="size-4 shrink-0 text-blue-400" />
                ) : (
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm">{entry.path}</span>
              </div>

              {entry.lastCommit && (
                <span
                  className="truncate text-muted-foreground text-sm"
                  title={entry.lastCommit.commit.message}
                >
                  {entry.lastCommit.commit.message.split("\n")[0]}
                </span>
              )}
              {!entry.lastCommit && <span />}

              {entry.lastCommit && (
                <span className="shrink-0 text-muted-foreground text-sm">
                  {formatDate(entry.lastCommit.commit.committer.timestamp)}
                </span>
              )}
              {!entry.lastCommit && <span />}
            </Link>
          );
        })}
      </div>

      {readmeEntry && (
        <ReadmeViewer
          filepath={readmeEntry.path}
          owner={owner}
          ref={ref}
          repo={repo}
        />
      )}
    </div>
  );
}

function ReadmeViewer({
  owner,
  repo,
  ref,
  filepath,
}: {
  owner: string;
  repo: string;
  ref: string;
  filepath: string;
}) {
  const { data: blob } = useSuspenseQuery(
    getBlobQueryOptions({
      owner,
      repo,
      ref,
      filepath,
    })
  );

  if (!blob || blob.isBinary) {
    return null;
  }

  const content = decodeURIComponent(
    atob(blob.content)
      .split("")
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );

  const isMarkdown = filepath.toLowerCase().match(/\.(md|mdx|markdown)$/);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-card px-4 py-3">
        <BookOpenIcon className="size-4" />
        <span className="font-semibold text-sm">{filepath}</span>
      </div>
      <div className="p-6">
        {isMarkdown ? (
          <ReactMarkdown
            components={components}
            rehypePlugins={[rehypeRaw]}
            remarkPlugins={[remarkGfm]}
          >
            {content}
          </ReactMarkdown>
        ) : (
          <pre className="overflow-x-auto font-mono text-sm">{content}</pre>
        )}
      </div>
    </div>
  );
}

function EmptyRepositoryInstructions({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  const data = Route.useLoaderData();
  const url = new URL(data.url);

  const repoUrl = `${url.origin ?? window.location.origin}/${owner}/${repo}.git`;

  return (
    <div className="py-12">
      <div className="mx-auto space-y-6">
        <div className="text-center">
          <h2 className="font-bold text-xl">This repository is empty.</h2>
          <p className="mt-2 text-muted-foreground">
            Get started by pushing an existing repository or creating a new one.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TerminalIcon className="size-5" />
              Create a new repository on the command line
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <CodeBlock
                code={`echo "# ${repo}" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin ${repoUrl}
git push -u origin main`}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TerminalIcon className="size-4" />
              Push an existing repository from the command line
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock
              code={`git remote add origin ${repoUrl}
git branch -M main
git push -u origin main`}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre>
      <code className="text-sm leading-relaxed">{code}</code>
    </pre>
  );
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return formatDistanceToNow(date, { addSuffix: true });
}
