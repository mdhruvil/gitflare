import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { type BundledLanguage, createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import * as z from "zod";
import { getRepoDOStub } from "@/do/repo";

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
  ref: z.string().default("HEAD"),
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
    queryKey: ["tree", data.owner, data.repo, data.ref, data.path],
    queryFn: async () => await getTreeFn({ data }),
  });

function getLanguageFromFilename(filename: string): BundledLanguage {
  const extension = filename.split(".").pop()?.toLowerCase() || "";

  const languageMap: Record<string, BundledLanguage> = {
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

export const getBlobFnSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  ref: z.string().default("HEAD"),
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
      return null;
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
