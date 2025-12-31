import { and, desc, eq } from "drizzle-orm";
import * as z from "zod";
import { DatabaseError } from "@/lib/errors";
import { fn } from "@/lib/fn";
import { Result } from "@/lib/result";
import { db } from ".";
import { pullRequest } from "./schema";

const getById = fn(z.object({ id: z.number() }), ({ id }) =>
  Result.tryCatchAsync(
    async () => {
      const result = await db.query.pullRequest.findFirst({
        where: eq(pullRequest.id, id),
      });
      return result ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const getByRepositoryId = fn(
  z.object({
    repositoryId: z.number(),
    status: z.enum(["open", "closed", "merged"]).optional(),
  }),
  ({ repositoryId, status }) =>
    Result.tryCatchAsync(
      async () => {
        const conditions = [eq(pullRequest.repositoryId, String(repositoryId))];
        if (status) {
          conditions.push(eq(pullRequest.status, status));
        }

        const prs = await db.query.pullRequest.findMany({
          where: and(...conditions),
          orderBy: desc(pullRequest.createdAt),
        });
        return prs;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const getByFullName = fn(
  z.object({
    fullName: z.string(),
    status: z.enum(["open", "closed", "merged"]).optional(),
  }),
  ({ fullName, status }) =>
    Result.tryCatchAsync(
      async () => {
        const conditions = [eq(pullRequest.fullName, fullName)];
        if (status) {
          conditions.push(eq(pullRequest.status, status));
        }

        const prs = await db.query.pullRequest.findMany({
          where: and(...conditions),
          orderBy: desc(pullRequest.createdAt),
        });
        return prs;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const getByFullNameAndNumber = fn(
  z.object({
    fullName: z.string(),
    number: z.number(),
  }),
  ({ fullName, number }) =>
    Result.tryCatchAsync(
      async () => {
        const result = await db.query.pullRequest.findFirst({
          where: and(
            eq(pullRequest.fullName, fullName),
            eq(pullRequest.number, number)
          ),
        });
        return result ?? null;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const getByCreatorId = fn(
  z.object({
    creatorId: z.string(),
    limit: z.number().optional().default(10),
  }),
  ({ creatorId, limit }) =>
    Result.tryCatchAsync(
      async () => {
        const prs = await db.query.pullRequest.findMany({
          where: eq(pullRequest.creatorId, creatorId),
          orderBy: desc(pullRequest.createdAt),
          limit,
        });
        return prs;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const countOpenByCreatorId = fn(
  z.object({ creatorId: z.string() }),
  ({ creatorId }) =>
    Result.tryCatchAsync(
      async () => {
        const prs = await db.query.pullRequest.findMany({
          where: and(
            eq(pullRequest.creatorId, creatorId),
            eq(pullRequest.status, "open")
          ),
          columns: { id: true },
        });
        return prs.length;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const getLastNumber = fn(z.object({ fullName: z.string() }), ({ fullName }) =>
  Result.tryCatchAsync(
    async () => {
      const lastPr = await db.query.pullRequest.findFirst({
        where: eq(pullRequest.fullName, fullName),
        orderBy: desc(pullRequest.number),
        columns: { number: true },
      });
      return lastPr?.number ?? 0;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const create = fn(
  z.object({
    repositoryId: z.number(),
    fullName: z.string(),
    number: z.number(),
    title: z.string(),
    body: z.string().optional(),
    intoBranch: z.string(),
    fromBranch: z.string(),
    creatorId: z.string(),
    creatorUsername: z.string(),
  }),
  ({
    repositoryId,
    fullName,
    number,
    title,
    body,
    intoBranch,
    fromBranch,
    creatorId,
    creatorUsername,
  }) =>
    Result.tryCatchAsync(
      async () => {
        const [created] = await db
          .insert(pullRequest)
          .values({
            repositoryId: String(repositoryId),
            fullName,
            number,
            title,
            body,
            status: "open",
            intoBranch,
            fromBranch,
            creatorId,
            creatorUsername,
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
    title: z.string().optional(),
    body: z.string().optional(),
    status: z.enum(["open", "closed", "merged"]).optional(),
    intoBranch: z.string().optional(),
    fromBranch: z.string().optional(),
  }),
  ({ id, title, body, status, intoBranch, fromBranch }) =>
    Result.tryCatchAsync(
      async () => {
        const updates: Partial<{
          title: string;
          body: string;
          status: "open" | "closed" | "merged";
          intoBranch: string;
          fromBranch: string;
        }> = {};

        if (title !== undefined) updates.title = title;
        if (body !== undefined) updates.body = body;
        if (status !== undefined) updates.status = status;
        if (intoBranch !== undefined) updates.intoBranch = intoBranch;
        if (fromBranch !== undefined) updates.fromBranch = fromBranch;

        const [updated] = await db
          .update(pullRequest)
          .set(updates)
          .where(eq(pullRequest.id, id))
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
        .delete(pullRequest)
        .where(eq(pullRequest.id, id))
        .returning();
      return deleted ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

export const PullRequest = {
  getById,
  getByRepositoryId,
  getByFullName,
  getByFullNameAndNumber,
  getByCreatorId,
  countOpenByCreatorId,
  getLastNumber,
  create,
  update,
  remove,
};
