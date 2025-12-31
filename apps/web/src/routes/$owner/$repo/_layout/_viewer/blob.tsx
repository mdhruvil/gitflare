import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, DownloadIcon, FileIcon } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { getBlobQueryOptions } from "@/api/tree";
import { NotFoundComponent } from "@/components/404-components";
import { components } from "@/components/md-components";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, getMimeType } from "@/lib/utils";

const searchSchema = z.object({
  ref: z.string().optional(),
  path: z.string(),
});

export const Route = createFileRoute("/$owner/$repo/_layout/_viewer/blob")({
  component: RouteComponent,
  notFoundComponent: NotFoundComponent,
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
        ref: deps.ref,
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
  const { ref, path: filepath } = search;

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

  const pathParts = filepath.split("/");
  const filename = pathParts.pop() || filepath;

  // Decode content only for text files
  let content = "";
  if (!blob.isBinary) {
    try {
      // Convert base64 to Uint8Array
      const binaryString = atob(blob.content);
      const bytes = new Uint8Array(
        Array.from(binaryString).map((char) => char.charCodeAt(0))
      );
      // Decode UTF-8 bytes to string
      const decoder = new TextDecoder("utf-8");
      content = decoder.decode(bytes);
    } catch (error) {
      // If UTF-8 decoding fails, fall back to treating as binary
      console.error("Failed to decode file content as UTF-8:", error);
      blob.isBinary = true;
    }
  }

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
              ({formatBytes(blob.size, { decimals: 2 })})
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
          <BlobContent blob={blob} content={content} filename={filename} />
        </div>
      </div>
    </div>
  );
}

type BlobContentProps = {
  blob: {
    content: string;
    size: number;
    isBinary: boolean;
    highlightedHtml?: string | null;
  };
  filename: string;
  content: string;
};

function BlobContent({ blob, filename, content }: BlobContentProps) {
  const isMarkdown = filename.toLowerCase().match(/\.(md|mdx|markdown)$/);
  const isImage = filename
    .toLowerCase()
    .match(/\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/);

  // Handle binary image files
  if (blob.isBinary && isImage) {
    return (
      <div className="flex flex-col items-center justify-center bg-muted/30">
        {/* biome-ignore lint/correctness/useImageSize: Dynamic image dimensions unknown until loaded */}
        <img
          alt={filename}
          className="max-w-full object-contain"
          loading="lazy"
          src={`data:${getMimeType(filename)};base64,${blob.content}`}
        />
      </div>
    );
  }

  // Handle other binary files
  if (blob.isBinary) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileIcon className="mb-4 size-12 text-muted-foreground" />
        <h3 className="mb-2 font-semibold text-lg">Binary file</h3>
        <p className="text-muted-foreground text-sm">
          This file cannot be displayed because it is a binary file.
        </p>
        <p className="mt-2 text-muted-foreground text-xs">
          Size: {formatBytes(blob.size, { decimals: 2 })}
        </p>
      </div>
    );
  }

  // Handle markdown files
  if (isMarkdown) {
    return (
      <div className="m-4">
        <ReactMarkdown
          components={components}
          rehypePlugins={[rehypeRaw]}
          remarkPlugins={[remarkGfm]}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  // Handle code files with syntax highlighting
  if (blob.highlightedHtml) {
    return (
      <div
        className="shiki-wrapper text-sm leading-relaxed [counter-reset:line] [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:p-4! [&_pre_.line:before]:mr-4 [&_pre_.line:before]:inline-block [&_pre_.line:before]:w-8 [&_pre_.line:before]:text-right [&_pre_.line:before]:text-muted-foreground [&_pre_.line:before]:[content:counter(line)] [&_pre_.line]:[counter-increment:line]"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki generates safe HTML on server
        dangerouslySetInnerHTML={{ __html: blob.highlightedHtml }}
      />
    );
  }

  // Fallback for plain text files without highlighting
  return (
    <div className="p-4">
      <pre className="whitespace-pre-wrap font-mono text-sm">{content}</pre>
    </div>
  );
}
