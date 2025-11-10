import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, DownloadIcon, FileIcon } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import ShikiHighlighter, { createJavaScriptRegexEngine } from "react-shiki";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { getBlobQueryOptions } from "@/api/tree";
import { components } from "@/components/md-components";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, getMimeType } from "@/lib/utils";

const searchSchema = z.object({
  ref: z.string().optional().default("main"),
  path: z.string(),
});

export const Route = createFileRoute("/$owner/$repo/_layout/_viewer/blob")({
  component: RouteComponent,
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    ref: search.ref,
    filepath: search.path,
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
  const { ref = "main", path: filepath } = search;

  const { data: blob } = useSuspenseQuery(
    getBlobQueryOptions({
      owner,
      repo,
      ref,
      filepath,
    })
  );

  const [isCopied, setIsCopied] = useState(false);

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

  function onCopyClick() {
    navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1000);
  }

  function onDownloadClick() {
    if (!blob) return;

    let downloadBlob: Blob;

    if (blob.isBinary) {
      // For binary files, decode base64 directly to binary
      const binaryString = atob(blob.content);
      const bytes = new Uint8Array(
        Array.from(binaryString).map((char) => char.charCodeAt(0))
      );
      downloadBlob = new Blob([bytes], { type: getMimeType(filename) });
    } else {
      // For text files, use the decoded content
      downloadBlob = new Blob([content], { type: getMimeType(filename) });
    }

    const url = URL.createObjectURL(downloadBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="py-6">
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between border-b bg-card px-3 py-1.5">
          <div className="text-sm">
            {filename}{" "}
            <span className="text-muted-foreground text-xs">
              ({formatBytes(blob.size)})
            </span>
          </div>

          <ButtonGroup>
            <Button size="sm" variant="outline">
              <Link
                params={{ owner, repo }}
                rel="noopener noreferrer"
                search={{ ref, path: filepath }}
                target="_blank"
                to="/$owner/$repo/raw"
              >
                Raw
              </Link>
            </Button>
            {!blob.isBinary && (
              <Button
                className="h-8"
                onClick={onCopyClick}
                size="icon"
                variant="outline"
              >
                {isCopied ? (
                  <CheckIcon className="size-4 text-green-600" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            )}
            <Button
              className="h-8"
              onClick={onDownloadClick}
              size="icon"
              variant="outline"
            >
              <DownloadIcon className="size-4" />
            </Button>
          </ButtonGroup>
        </div>
        <div className="overflow-hidden">
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
              engine={createJavaScriptRegexEngine()}
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
    </div>
  );
}

function getLanguageFromFilename(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() || "";

  const languageMap: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    mts: "typescript",
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
