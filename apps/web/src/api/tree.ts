import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { getRepoDOStub } from "@/do/repo";

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
    queryKey: ["tree", data.owner, data.repo, data.ref, data.path].filter(
      Boolean
    ),
    queryFn: async () => await getTreeFn({ data }),
  });

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

    const contentBase64 = Buffer.from(blob.content).toString("base64");

    return {
      oid: blob.oid,
      content: contentBase64,
      size: blob.size,
      isBinary: blob.isBinary,
    };
  });

export const getBlobQueryOptions = (data: z.infer<typeof getBlobFnSchema>) =>
  queryOptions({
    queryKey: ["blob", data.owner, data.repo, data.ref, data.filepath].filter(
      Boolean
    ),
    queryFn: async () => await getBlobFn({ data }),
  });
