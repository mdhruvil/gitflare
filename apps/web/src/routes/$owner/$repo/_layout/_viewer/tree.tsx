import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { FileIcon, FolderIcon } from "lucide-react";
import { z } from "zod";
import { getTreeQueryOptions } from "@/api/tree";
import { Skeleton } from "@/components/ui/skeleton";

const searchSchema = z.object({
  ref: z.string().optional().default("main"),
  path: z.string().optional().default(""),
});

export const Route = createFileRoute("/$owner/$repo/_layout/_viewer/tree")({
  component: RouteComponent,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    ref: search.ref,
    path: search.path,
  }),
  loader: async ({ params, context: { queryClient }, deps }) => {
    await queryClient.ensureQueryData(
      getTreeQueryOptions({
        owner: params.owner,
        repo: params.repo,
        ref: deps.ref,
        path: deps.path,
      })
    );
  },
  pendingComponent: TreePendingComponent,
});

function TreePendingComponent() {
  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-[180px]" />
      </div>
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
  const { ref = "main", path = "" } = search;

  const { data: tree } = useSuspenseQuery(
    getTreeQueryOptions({
      owner,
      repo,
      ref,
      path,
    })
  );

  const sortedTree = [...tree].sort((a, b) => {
    const aIsDir = a.type === "tree";
    const bIsDir = b.type === "tree";

    if (aIsDir !== bIsDir) {
      return aIsDir ? -1 : 1;
    }

    return a.path.localeCompare(b.path);
  });

  return (
    <div className="py-6">
      <div className="divide-y overflow-hidden rounded-lg border">
        {sortedTree.map((entry) => {
          const isDirectory = entry.type === "tree";
          const newPath = path ? `${path}/${entry.path}` : entry.path;

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

        {sortedTree.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderIcon className="mb-4 size-12 text-muted-foreground" />
            <h3 className="mb-2 font-semibold text-lg">Empty directory</h3>
            <p className="text-muted-foreground text-sm">
              This directory doesn&apos;t contain any files yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return formatDistanceToNow(date, { addSuffix: true });
}
