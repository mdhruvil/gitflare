import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon, FileIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import ShikiHighlighter from "react-shiki";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { getBranchesQueryOptions } from "@/api/branches";
import { getBlobQueryOptions } from "@/api/tree";
import { components } from "@/components/md-components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const searchSchema = z.object({
  ref: z.string().optional().default("main"),
  filepath: z.string(),
});

export const Route = createFileRoute("/$owner/$repo/_layout/blob")({
  component: RouteComponent,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    ref: search.ref,
    filepath: search.filepath,
  }),
  loader: async ({ params, context: { queryClient }, deps }) => {
    await queryClient.ensureQueryData(
      getBlobQueryOptions({
        owner: params.owner,
        repo: params.repo,
        ref: deps.ref || "main",
        filepath: deps.filepath,
      })
    );
  },
  pendingComponent: BlobPendingComponent,
});

function BlobPendingComponent() {
  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-[180px]" />
      </div>
      <Skeleton className="h-[400px] w-full rounded-lg" />
    </div>
  );
}

function RouteComponent() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const { owner, repo } = params;
  const { ref = "main", filepath } = search;

  const [selectedBranch, setSelectedBranch] = useState<string>(ref);

  const { data: blob } = useSuspenseQuery(
    getBlobQueryOptions({
      owner,
      repo,
      ref: selectedBranch,
      filepath,
    })
  );

  if (!blob) {
    return (
      <div className="py-6">
        <div className="flex flex-col items-center justify-center rounded-lg border py-12 text-center">
          <FileIcon className="mb-4 size-12 text-muted-foreground" />
          <h3 className="mb-2 font-semibold text-lg">File not found</h3>
          <p className="text-muted-foreground text-sm">
            The requested file could not be found.
          </p>
        </div>
      </div>
    );
  }

  const content = decodeURIComponent(
    atob(blob.content)
      .split("")
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );

  const pathParts = filepath.split("/");
  const filename = pathParts.pop() || filepath;

  const language = getLanguageFromFilename(filename);

  const isMarkdown = filename.toLowerCase().match(/\.(md|mdx|markdown)$/);

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <Breadcrumb filepath={filepath} ref={selectedBranch} repo={repo} />
        <BranchSelector
          onBranchChange={setSelectedBranch}
          owner={owner}
          repo={repo}
          selectedBranch={selectedBranch}
        />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {blob.isBinary && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileIcon className="mb-4 size-12 text-muted-foreground" />
            <h3 className="mb-2 font-semibold text-lg">Binary file</h3>
            <p className="text-muted-foreground text-sm">
              This file cannot be displayed because it is a binary file.
            </p>
            <p className="mt-2 text-muted-foreground text-xs">
              Size: {(blob.size / 1024).toFixed(2)} KB
            </p>
          </div>
        )}
        {!blob.isBinary && isMarkdown && (
          <div className="m-4">
            <ReactMarkdown
              components={components}
              rehypePlugins={[rehypeRaw]}
              remarkPlugins={[remarkGfm]}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
        {!blob.isBinary && !isMarkdown && (
          <ShikiHighlighter
            className="text-sm leading-relaxed"
            language={language}
            showLanguage={false}
            showLineNumbers
            theme="github-dark-default"
          >
            {content}
          </ShikiHighlighter>
        )}
      </div>
    </div>
  );
}

function Breadcrumb({
  repo,
  ref,
  filepath,
}: {
  repo: string;
  ref: string;
  filepath: string;
}) {
  const params = Route.useParams();
  const pathParts = filepath.split("/").filter(Boolean);
  const filename = pathParts.at(-1);
  const dirParts = pathParts.slice(0, -1);

  return (
    <div className="flex items-center gap-2 text-sm">
      <Link
        className="font-semibold text-foreground hover:underline"
        params={params}
        search={{ ref, path: "" }}
        to="/$owner/$repo/tree"
      >
        {repo}
      </Link>
      {dirParts.map((part, index) => {
        const pathUpToHere = dirParts.slice(0, index + 1).join("/");
        return (
          <div className="flex items-center gap-2" key={pathUpToHere}>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
            <Link
              className="text-muted-foreground hover:text-foreground hover:underline"
              params={params}
              search={{ ref, path: pathUpToHere }}
              to="/$owner/$repo/tree"
            >
              {part}
            </Link>
          </div>
        );
      })}
      {filename && (
        <div className="flex items-center gap-2">
          <ChevronRightIcon className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{filename}</span>
        </div>
      )}
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

function getLanguageFromFilename(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() || "";

  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "fish",
    ps1: "powershell",
    r: "r",
    lua: "lua",
    perl: "perl",
    pl: "perl",
    sql: "sql",
    html: "html",
    htm: "html",
    xml: "xml",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    json: "json",
    jsonc: "jsonc",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    ini: "ini",
    md: "markdown",
    markdown: "markdown",
    tex: "latex",
    vue: "vue",
    svelte: "svelte",
    astro: "astro",
    graphql: "graphql",
    gql: "graphql",
    dockerfile: "dockerfile",
    makefile: "makefile",
    proto: "proto",
  };

  const filenameUpper = filename.toUpperCase();
  if (filenameUpper === "DOCKERFILE") return "dockerfile";
  if (filenameUpper === "MAKEFILE") return "makefile";

  return languageMap[extension] || "text";
}
