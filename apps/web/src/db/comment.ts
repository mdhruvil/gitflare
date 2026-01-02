import { asc, eq } from "drizzle-orm";
import * as z from "zod";
import { DatabaseError } from "@/lib/errors";
import { fn } from "@/lib/fn";
import { Result } from "@/lib/result";
import { db } from ".";
import { comment } from "./schema";

const getById = fn(z.object({ id: z.number() }), ({ id }) =>
  Result.tryCatchAsync(
    async () => {
      const result = await db.query.comment.findFirst({
        where: eq(comment.id, id),
      });
      return result ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const getByIssueId = fn(z.object({ issueId: z.number() }), ({ issueId }) =>
  Result.tryCatchAsync(
    async () => {
      const comments = await db.query.comment.findMany({
        where: eq(comment.issueId, issueId),
        orderBy: asc(comment.createdAt),
      });
      return comments;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const getByPullRequestId = fn(
  z.object({ pullRequestId: z.number() }),
  ({ pullRequestId }) =>
    Result.tryCatchAsync(
      async () => {
        const comments = await db.query.comment.findMany({
          where: eq(comment.pullRequestId, pullRequestId),
          orderBy: asc(comment.createdAt),
        });
        return comments;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const createForIssue = fn(
  z.object({
    issueId: z.number(),
    authorId: z.string(),
    authorUsername: z.string(),
    body: z.string(),
  }),
  ({ issueId, authorId, authorUsername, body }) =>
    Result.tryCatchAsync(
      async () => {
        const [created] = await db
          .insert(comment)
          .values({
            issueId,
            authorId,
            authorUsername,
            body,
          })
          .returning();
        return created;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const createForPullRequest = fn(
  z.object({
    pullRequestId: z.number(),
    authorId: z.string(),
    authorUsername: z.string(),
    body: z.string(),
  }),
  ({ pullRequestId, authorId, authorUsername, body }) =>
    Result.tryCatchAsync(
      async () => {
        const [created] = await db
          .insert(comment)
          .values({
            pullRequestId,
            authorId,
            authorUsername,
            body,
          })
          .returning();
        return created;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const update = fn(
  z.object({
    id: z.number(),
    body: z.string(),
  }),
  ({ id, body }) =>
    Result.tryCatchAsync(
      async () => {
        const [updated] = await db
          .update(comment)
          .set({ body })
          .where(eq(comment.id, id))
          .returning();
        return updated ?? null;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const remove = fn(z.object({ id: z.number() }), ({ id }) =>
  Result.tryCatchAsync(
    async () => {
      const [deleted] = await db
        .delete(comment)
        .where(eq(comment.id, id))
        .returning();
      return deleted ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

export const Comment = {
  getById,
  getByIssueId,
  getByPullRequestId,
  createForIssue,
  createForPullRequest,
  update,
  remove,
};
