import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import * as z from "zod";
import { Issue } from "@/db/issue";
import { Repo } from "@/db/repo";
import { auth } from "@/lib/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { Result } from "@/lib/result";

const getIssuesByRepoSchema = z.object({
  owner: z.string(),
  repo: z.string(),
});

const getIssuesByRepoFn = createServerFn({ method: "GET" })
  .inputValidator(getIssuesByRepoSchema)
  .handler(async ({ data }) => {
    const result = await Issue.getByFullName({
      fullName: `${data.owner}/${data.repo}`,
    });

    return result.unwrapOrThrow({
      DatabaseError: "Database error occurred while fetching issues.",
      ValidationError: `Invalid owner or repository name (${data.owner}/${data.repo}) provided.`,
    });
  });

export const getIssuesByRepoOptions = (
  data: z.infer<typeof getIssuesByRepoSchema>
) =>
  queryOptions({
    queryKey: ["issuesByRepo", data.owner, data.repo],
    queryFn: async () => await getIssuesByRepoFn({ data }),
  });

export const getIssueByRepoAndNumberSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
});

export const getIssueByRepoAndNumberFn = createServerFn({ method: "GET" })
  .inputValidator(getIssueByRepoAndNumberSchema)
  .handler(async ({ data }) => {
    const result = (
      await Issue.getByFullNameAndNumber({
        fullName: `${data.owner}/${data.repo}`,
        number: data.number,
      })
    ).andThen((issue) =>
      issue
        ? Result.ok(issue)
        : Result.err(new NotFoundError({ what: "Issue" }))
    );

    return result.unwrapOrThrow({
      DatabaseError: "Database error occurred while fetching issue.",
      ValidationError: `Invalid owner or repository name (${data.owner}/${data.repo}) or number (${data.number}) provided.`,
      NotFoundError: `Issue not found (${data.owner}/${data.repo}#${data.number})`,
    });
  });

export const getIssueByRepoAndNumberOptions = (
  data: z.infer<typeof getIssueByRepoAndNumberSchema>
) =>
  queryOptions({
    queryKey: ["issueByRepoAndNumber", data.owner, data.repo, data.number],
    queryFn: async () => await getIssueByRepoAndNumberFn({ data }),
  });

export const updateIssueStatusSchema = z.object({
  issueId: z.number(),
  status: z.enum(["open", "closed"]),
});

export const updateIssueStatusFn = createServerFn({ method: "POST" })
  .inputValidator(updateIssueStatusSchema)
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
      UnauthorizedError: "You must be logged in to update an issue.",
    });

    const issueResult = (await Issue.getById({ id: data.issueId }))
      .andThen((issue) =>
        issue
          ? Result.ok(issue)
          : Result.err(new NotFoundError({ what: "Issue" }))
      )
      .andThen((issue) =>
        issue.creatorId === user.id
          ? Result.ok(issue)
          : Result.err(new UnauthorizedError())
      );

    const issue = issueResult.unwrapOrThrow({
      DatabaseError: "Database error occurred while fetching issue.",
      ValidationError: `Invalid issue ID (${data.issueId}) provided.`,
      NotFoundError: `Issue not found (ID: ${data.issueId})`,
      UnauthorizedError: `You do not have permission to update this issue (ID: ${data.issueId})`,
    });

    const updatedIssueResult = await Issue.update({
      id: issue.id,
      status: data.status,
    });

    const updatedIssue = updatedIssueResult.unwrapOrThrow({
      DatabaseError: "Database error occurred while updating issue.",
      ValidationError: `Invalid issue ID (${data.issueId}) provided.`,
    });

    return updatedIssue;
  });

export const createIssueSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  title: z.string(),
  body: z.string(),
});

export const createIssueFn = createServerFn({ method: "POST" })
  .inputValidator(createIssueSchema)
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
      UnauthorizedError: "You must be logged in to create an issue.",
    });

    if (!user.username) {
      throw new Error("User does not have a username");
    }

    const repositoryResult = (
      await Repo.getByOwnerAndName({
        owner: data.owner,
        name: data.repo,
      })
    ).andThen((repository) =>
      repository
        ? Result.ok(repository)
        : Result.err(new NotFoundError({ what: "Repository" }))
    );

    const repository = repositoryResult.unwrapOrThrow({
      DatabaseError: "Database error occurred while fetching repository.",
      ValidationError: `Invalid owner or repository name (${data.owner}/${data.repo}) provided.`,
      NotFoundError: `Repository not found (${data.owner}/${data.repo})`,
    });

    const issueResult = await Issue.create({
      creatorId: user.id,
      creatorUsername: user.username,
      repositoryId: repository.id,
      fullName: `${data.owner}/${data.repo}`,
      number: 1,
      title: data.title,
      body: data.body,
    });

    return issueResult.unwrapOrThrow({
      DatabaseError: "Database error occurred while creating issue.",
    });
  });
