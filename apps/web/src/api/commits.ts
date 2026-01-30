import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

type Commit = {
  oid: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      timestamp: number;
    };
    parent: string[];
  };
};

type FileChange = {
  path: string;
  type: "add" | "remove" | "modify";
  old?: { content: string; isBinary: boolean };
  new?: { content: string; isBinary: boolean };
};

export const getCommitFnSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  ref: z.string().optional(),
  limit: z.number().optional(),
});

export const getCommitsFn = createServerFn({ method: "GET" })
  .inputValidator(getCommitFnSchema)
  .handler(async ({ data }): Promise<Commit[]> => {
    // TODO: Implement actual commit fetching from HybridRepo DO
    console.log("getCommits called for:", data.owner, data.repo);
    return [
      {
        oid: "abc123def456789",
        commit: {
          message: "Initial commit",
          author: {
            name: "Demo User",
            email: "demo@example.com",
            timestamp: Date.now() / 1000,
          },
          parent: [],
        },
      },
    ];
  });

export const getCommitsQueryOptions = (
  data: z.infer<typeof getCommitFnSchema>
) =>
  queryOptions({
    queryKey: ["commits", data.owner, data.repo, data.ref, data.limit].filter(
      Boolean
    ),
    queryFn: async () => await getCommitsFn({ data }),
  });

export const getCommitSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  commitOid: z.string(),
});

export const getCommitFn = createServerFn({ method: "GET" })
  .inputValidator(getCommitSchema)
  .handler(
    async ({ data }): Promise<{ commit: Commit; changes: FileChange[] }> => {
      // TODO: Implement actual commit fetching from HybridRepo DO
      console.log(
        "getCommit called for:",
        data.owner,
        data.repo,
        data.commitOid
      );
      return {
        commit: {
          oid: data.commitOid,
          commit: {
            message: "Initial commit",
            author: {
              name: "Demo User",
              email: "demo@example.com",
              timestamp: Date.now() / 1000,
            },
            parent: [],
          },
        },
        changes: [
          {
            path: "README.md",
            type: "add",
            new: { content: "# Hello World", isBinary: false },
          },
        ],
      };
    }
  );

export const getCommitQueryOptions = (data: z.infer<typeof getCommitSchema>) =>
  queryOptions({
    queryKey: ["commit", data.owner, data.repo, data.commitOid],
    queryFn: async () => await getCommitFn({ data }),
  });
