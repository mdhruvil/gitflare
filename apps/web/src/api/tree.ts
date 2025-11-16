import { queryOptions } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import * as z from "zod";
import { getRepoDOStub } from "@/do/repo";
import { getLanguageFromFilename } from "@/lib/utils";

// Create highlighter instance with JavaScript regex engine
const highlighterPromise = createHighlighter({
  themes: ["github-dark-default"],
  langs: [],
  engine: createJavaScriptRegexEngine({
    forgiving: true,
  }),
});

export const getTreeFnSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  ref: z.string().optional(),
  path: z.string().optional(),
});

export const getTreeFn = createServerFn({ method: "GET" })
  .inputValidator(getTreeFnSchema)
  .handler(async ({ data }) => {
    const fullName = `${data.owner}/${data.repo}`;
    const stub = getRepoDOStub(fullName);
    const tree = await stub.getTree({
      ref: data.ref,
      path: data.path,
    });
    return tree;
  });

export const getTreeQueryOptions = (data: z.infer<typeof getTreeFnSchema>) =>
  queryOptions({
    queryKey: ["tree", data.owner, data.repo, data.ref, data.path].filter(
      Boolean
    ),
    queryFn: async () => await getTreeFn({ data }),
  });

export const getBlobFnSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  ref: z.string().optional(),
  filepath: z.string(),
});

export const getBlobFn = createServerFn({ method: "GET" })
  .inputValidator(getBlobFnSchema)
  .handler(async ({ data }) => {
    const fullName = `${data.owner}/${data.repo}`;
    const stub = getRepoDOStub(fullName);
    const blob = await stub.getBlob({
      ref: data.ref,
      filepath: data.filepath,
    });

    if (!blob) {
      throw notFound();
    }

    // WE HAVE TO DO THIS BECAUSE OF CACHE SERIALIZATION ISSUES (TODO: REFACTOR)
    // Handle blob.content which might be a Uint8Array or a plain object from JSON serialization
    let contentBuffer: Buffer;
    if (blob.content instanceof Uint8Array) {
      contentBuffer = Buffer.from(blob.content);
    } else if (typeof blob.content === "object" && blob.content !== null) {
      // Handle JSON-serialized Uint8Array (object with numeric keys)
      contentBuffer = Buffer.from(Object.values(blob.content) as number[]);
    } else {
      contentBuffer = Buffer.from(blob.content as string);
    }

    const contentBase64 = contentBuffer.toString("base64");

    // Check if it's markdown
    const filename = data.filepath.split("/").pop() || data.filepath;
    const isMarkdown = filename.toLowerCase().match(/\.(md|mdx|markdown)$/);

    // Generate syntax-highlighted HTML for non-binary, non-markdown files
    let highlightedHtml: string | null = null;
    if (!blob.isBinary && !isMarkdown) {
      const language = getLanguageFromFilename(filename);
      const highlighter = await highlighterPromise;

      // Decode content for highlighting
      const decoder = new TextDecoder("utf-8");
      const content = decoder.decode(contentBuffer);

      try {
        await highlighter.loadLanguage(language);
      } catch {
        // Language not found, will use no highlighting
        console.warn(`Language "${language}" not found for file "${filename}"`);
      }

      highlightedHtml = highlighter.codeToHtml(content, {
        lang: language,
        theme: "github-dark-default",
        transformers: [
          {
            line(node, line) {
              node.properties["data-line"] = line;
            },
          },
        ],
      });
    }

    return {
      oid: blob.oid,
      content: contentBase64,
      size: blob.size,
      isBinary: blob.isBinary,
      highlightedHtml,
    };
  });

export const getBlobQueryOptions = (data: z.infer<typeof getBlobFnSchema>) =>
  queryOptions({
    queryKey: ["blob", data.owner, data.repo, data.ref, data.filepath].filter(
      Boolean
    ),
    queryFn: async () => await getBlobFn({ data }),
  });
