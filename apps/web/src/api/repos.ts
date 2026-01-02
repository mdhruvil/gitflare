import { queryOptions } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import * as z from "zod";
import { Repo } from "@/db/repo";
import { getRepoDOStub } from "@/do/repo";
import { auth } from "@/lib/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { Result } from "@/lib/result";

const getReposByOwnerInputSchema = z.object({
  owner: z.string().min(1),
});

export const getReposByOwnerFn = createServerFn({
  method: "GET",
})
  .inputValidator(getReposByOwnerInputSchema)
  .handler(async ({ data }) => {
    const result = await Repo.getByOwner({ owner: data.owner });
    return result.unwrapOrThrow({
      DatabaseError: "Database error occurred while fetching repositories.",
      ValidationError: `Invalid owner name (${data.owner}) provided.`,
    });
  });

export const getReposByOwnerOpts = (
  data: z.infer<typeof getReposByOwnerInputSchema>
) =>
  queryOptions({
    queryKey: ["reposByOwner", data.owner],
    queryFn: async () => await getReposByOwnerFn({ data }),
  });

const getRepoByOwnerAndNameSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
});

export const getRepoByOwnerAndNameFn = createServerFn({
  method: "GET",
})
  .inputValidator(getRepoByOwnerAndNameSchema)
  .handler(async ({ data }) => {
    const result = await Repo.getByOwnerAndName(data);
    const repo = result.unwrapOrThrow({
      DatabaseError: "Database error occurred while fetching repository.",
    });
    if (!repo) {
      throw notFound();
    }
    return repo;
  });

export const getRepoByOwnerAndNameOpts = (
  data: z.infer<typeof getRepoByOwnerAndNameSchema>
) =>
  queryOptions({
    queryKey: ["repoByOwnerAndName", data.owner, data.name],
    queryFn: async () => await getRepoByOwnerAndNameFn({ data }),
  });

export const createRepoSchema = z.object({
  name: z
    .string()
    .min(1, { message: "Repository name is required" })
    .max(100, { message: "Repository name must be less than 100 characters" })
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message:
        "Repository name can only contain letters, numbers, hyphens, and underscores",
    })
    .refine((val) => val.endsWith(".git") === false, {
      message: "Repository name cannot end with .git",
    }),
  description: z
    .string()
    .max(500, { message: "Description must be less than 500 characters" }),
  isPrivate: z.boolean(),
});

export const createRepoFn = createServerFn({
  method: "POST",
})
  .inputValidator(createRepoSchema)
  .handler(async ({ data }) => {
    const sessionResult = (
      await Result.tryCatchAsync(
        () => auth.api.getSession({ headers: getRequestHeaders() }),
        (e) => new UnauthorizedError({ cause: e })
      )
    ).andThen((session) =>
      session ? Result.ok(session) : Result.err(new UnauthorizedError())
    );

    const { user } = sessionResult.unwrapOrThrow({
      UnauthorizedError: "You must be logged in to create a repository.",
    });
    if (!user.username) {
      throw new Error("User does not have a username");
    }

    const result = await Repo.create({
      name: data.name,
      description: data.description.trim() || undefined,
      isPrivate: data.isPrivate,
      ownerId: user.id,
      owner: user.username,
    });

    const repo = result.unwrapOrThrow({
      DatabaseError: "Database error occurred while creating repository.",
    });

    const fullName = `${repo.owner}/${repo.name}`;

    const stub = getRepoDOStub(fullName);
    await stub.ensureRepoInitialized();

    return repo;
  });

export const updateRepoSchema = z.object({
  id: z.number(),
  description: z.string().optional(),
  isPrivate: z.boolean(),
});

export const updateRepoFn = createServerFn({
  method: "POST",
})
  .inputValidator(updateRepoSchema)
  .handler(async ({ data }) => {
    const sessionResult = (
      await Result.tryCatchAsync(
        () => auth.api.getSession({ headers: getRequestHeaders() }),
        (e) => new UnauthorizedError({ cause: e })
      )
    ).andThen((session) =>
      session ? Result.ok(session) : Result.err(new UnauthorizedError())
    );

    const { user } = sessionResult.unwrapOrThrow({
      UnauthorizedError: "You must be logged in to update a repository.",
    });

    const repoResult = (await Repo.getById({ id: data.id }))
      .andThen((repo) =>
        repo
          ? Result.ok(repo)
          : Result.err(new NotFoundError({ what: "Repository" }))
      )
      .andThen((repo) =>
        repo.ownerId === user.id
          ? Result.ok(repo)
          : Result.err(new UnauthorizedError())
      );

    const repo = repoResult.unwrapOrThrow({
      DatabaseError: "Database error occurred.",
      NotFoundError: `Repository not found (ID: ${data.id})`,
      UnauthorizedError: `You do not have permission to update this repository (ID: ${data.id})`,
      ValidationError: `Invalid repository ID (ID: ${data.id}) provided.`,
    });

    const updatedRepoResult = await Repo.update({
      id: repo.id,
      description: data.description?.trim() || undefined,
      isPrivate: data.isPrivate,
      ownerId: repo.ownerId,
    });
    const updatedRepo = updatedRepoResult.unwrapOrThrow({
      DatabaseError: "Database error occurred while updating repository.",
      ValidationError: `Invalid repository ID (ID: ${data.id}) provided.`,
    });
    return updatedRepo;
  });
