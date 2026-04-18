import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  LoaderIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
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
import { diffsStyleVariables, fileOptions } from "@/lib/diffs-config";
import { formatBytes, getMimeType } from "@/lib/utils";

const LazyDiffsFile = lazy(() =>
  import("@pierre/diffs/react").then((m) => ({ default: m.File }))
);

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
          <BlobContent
            content={content}
            contentBase64={blob.content}
            filename={filename}
            isBinary={blob.isBinary}
            size={blob.size}
          />
        </div>
      </div>
    </div>
  );
}

function PlainTextViewer({ content }: { content: string }) {
  const lines = content.split("\n");
  const gutterWidth = String(lines.length).length;
  return (
    <div className="overflow-x-auto font-mono text-[13px] leading-5">
      <table className="border-collapse">
        <tbody>
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: line numbers are stable
            <tr key={i}>
              <td
                className="sticky left-0 select-none px-3 text-right text-muted-foreground/40"
                style={{ minWidth: `${gutterWidth + 2}ch` }}
              >
                {i + 1}
              </td>
              <td className="whitespace-pre pr-6 pl-4">{line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type BlobContentProps = {
  size: number;
  isBinary: boolean;
  filename: string;
  /** Decoded text content (empty for binary files) */
  content: string;
  /** Raw base64-encoded content (needed for binary image rendering) */
  contentBase64: string;
};

function BlobContent({
  isBinary,
  filename,
  content,
  contentBase64,
  size,
}: BlobContentProps) {
  const isMarkdown = filename.toLowerCase().match(/\.(md|mdx|markdown)$/);
  const isImage = filename
    .toLowerCase()
    .match(/\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/);

  // Handle binary image files
  if (isBinary && isImage) {
    return (
      <div className="flex flex-col items-center justify-center bg-muted/30">
        {/* biome-ignore lint/correctness/useImageSize: Dynamic image dimensions unknown until loaded */}
        <img
          alt={filename}
          className="max-w-full object-contain"
          loading="lazy"
          src={`data:${getMimeType(filename)};base64,${contentBase64}`}
        />
      </div>
    );
  }

  // Handle other binary files
  if (isBinary) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileIcon className="mb-4 size-12 text-muted-foreground" />
        <h3 className="mb-2 font-semibold text-lg">Binary file</h3>
        <p className="text-muted-foreground text-sm">
          This file cannot be displayed because it is a binary file.
        </p>
        <p className="mt-2 text-muted-foreground text-xs">
          Size: {formatBytes(size, { decimals: 2 })}
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

  // Files without a real extension (LICENSE, Makefile, .gitignore, .env, etc.)
  // are rendered as plain text -- @pierre/diffs hangs on these.
  // A "real" extension is a dot that isn't the first character, with chars after it.
  const lastDotIndex = filename.lastIndexOf(".");
  const hasCodeExtension =
    lastDotIndex > 0 && lastDotIndex < filename.length - 1;

  if (!hasCodeExtension) {
    return <PlainTextViewer content={content} />;
  }

  // Handle code files with syntax highlighting via @pierre/diffs
  return (
    <div style={diffsStyleVariables}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <LazyDiffsFile
          file={{ name: filename, contents: content }}
          options={fileOptions}
        />
      </Suspense>
    </div>
  );
}
