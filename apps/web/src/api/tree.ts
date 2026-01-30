import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import * as z from "zod";
import { getLanguageFromFilename } from "@/lib/utils";

// Create highlighter instance with JavaScript regex engine
const highlighterPromise = createHighlighter({
  themes: ["github-dark-default"],
  langs: [],
  engine: createJavaScriptRegexEngine({
    forgiving: true,
  }),
});

type TreeEntry = {
  oid: string;
  path: string;
  type: "tree" | "blob";
  lastCommit?: {
    oid: string;
    commit: {
      message: string;
      committer: {
        timestamp: number;
      };
    };
  };
};

export const getTreeFnSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  ref: z.string().optional(),
  path: z.string().optional(),
});

export const getTreeFn = createServerFn({ method: "GET" })
  .inputValidator(getTreeFnSchema)
  .handler(async ({ data }): Promise<TreeEntry[]> => {
    // TODO: Implement actual tree fetching from HybridRepo DO
    console.log("getTree called for:", data.owner, data.repo);
    return [
      {
        oid: "abc123def456",
        path: "src",
        type: "tree",
        lastCommit: {
          oid: "commit123",
          commit: {
            message: "Initial commit",
            committer: { timestamp: Date.now() / 1000 },
          },
        },
      },
      {
        oid: "def456abc789",
        path: "README.md",
        type: "blob",
        lastCommit: {
          oid: "commit123",
          commit: {
            message: "Initial commit",
            committer: { timestamp: Date.now() / 1000 },
          },
        },
      },
    ];
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
    // TODO: Implement actual blob fetching from HybridRepo DO
    const filename = data.filepath.split("/").pop() || data.filepath;
    const isMarkdown = filename.toLowerCase().match(/\.(md|mdx|markdown)$/);

    const dummyContent = `# ${data.repo}\n\nThis is a placeholder README for ${data.owner}/${data.repo}.`;
    const contentBuffer = Buffer.from(dummyContent);
    const contentBase64 = contentBuffer.toString("base64");

    let highlightedHtml: string | null = null;
    if (!isMarkdown) {
      const language = getLanguageFromFilename(filename);
      const highlighter = await highlighterPromise;

      try {
        await highlighter.loadLanguage(language);
      } catch {
        console.warn(`Language "${language}" not found for file "${filename}"`);
      }

      highlightedHtml = highlighter.codeToHtml(dummyContent, {
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
      oid: "dummy-blob-oid-123",
      content: contentBase64,
      size: contentBuffer.length,
      isBinary: false,
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
