import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

export const getBrancesFnSchema = z.object({
  owner: z.string(),
  repo: z.string(),
});

export const getBranchesFn = createServerFn({ method: "GET" })
  .inputValidator(getBrancesFnSchema)
  .handler(async ({ data }) => {
    // TODO: Implement actual branch fetching from HybridRepo DO
    console.log("getBranches called for:", data.owner, data.repo);
    return {
      branches: ["main"],
      currentBranch: "main",
    };
  });

export const getBranchesQueryOptions = (
  data: z.infer<typeof getBrancesFnSchema>
) =>
  queryOptions({
    queryKey: ["branches", data.owner, data.repo],
    queryFn: async () => await getBranchesFn({ data }),
  });
