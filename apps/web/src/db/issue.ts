import { and, desc, eq } from "drizzle-orm";
import * as z from "zod";
import { DatabaseError } from "@/lib/errors";
import { fn } from "@/lib/fn";
import { Result } from "@/lib/result";
import { db } from ".";
import { issue } from "./schema";

const getById = fn(z.object({ id: z.number() }), ({ id }) =>
  Result.tryCatchAsync(
    async () => {
      const result = await db.query.issue.findFirst({
        where: eq(issue.id, id),
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
    status: z.enum(["open", "closed"]).optional(),
  }),
  ({ repositoryId, status }) =>
    Result.tryCatchAsync(
      async () => {
        const conditions = [eq(issue.repositoryId, String(repositoryId))];
        if (status) {
          conditions.push(eq(issue.status, status));
        }

        const issues = await db.query.issue.findMany({
          where: and(...conditions),
          orderBy: desc(issue.createdAt),
        });
        return issues;
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
    status: z.enum(["open", "closed"]).optional(),
  }),
  ({ fullName, status }) =>
    Result.tryCatchAsync(
      async () => {
        const conditions = [eq(issue.fullName, fullName)];
        if (status) {
          conditions.push(eq(issue.status, status));
        }

        const issues = await db.query.issue.findMany({
          where: and(...conditions),
          orderBy: desc(issue.createdAt),
        });
        return issues;
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
        const result = await db.query.issue.findFirst({
          where: and(eq(issue.fullName, fullName), eq(issue.number, number)),
          with: {
            comments: true,
          },
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
        const issues = await db.query.issue.findMany({
          where: eq(issue.creatorId, creatorId),
          orderBy: desc(issue.createdAt),
          limit,
        });
        return issues;
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
        const issues = await db.query.issue.findMany({
          where: and(eq(issue.creatorId, creatorId), eq(issue.status, "open")),
          columns: { id: true },
        });
        return issues.length;
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
      const lastIssue = await db.query.issue.findFirst({
        where: eq(issue.fullName, fullName),
        orderBy: desc(issue.number),
        columns: { number: true },
      });
      return lastIssue?.number ?? 0;
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
    creatorId: z.string(),
    creatorUsername: z.string(),
  }),
  ({
    repositoryId,
    fullName,
    number,
    title,
    body,
    creatorId,
    creatorUsername,
  }) =>
    Result.tryCatchAsync(
      async () => {
        const [created] = await db
          .insert(issue)
          .values({
            repositoryId: String(repositoryId),
            fullName,
            number,
            title,
            body,
            status: "open",
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
    status: z.enum(["open", "closed"]).optional(),
  }),
  ({ id, title, body, status }) =>
    Result.tryCatchAsync(
      async () => {
        const updates: Partial<{
          title: string;
          body: string;
          status: "open" | "closed";
        }> = {};

        if (title !== undefined) updates.title = title;
        if (body !== undefined) updates.body = body;
        if (status !== undefined) updates.status = status;

        const [updated] = await db
          .update(issue)
          .set(updates)
          .where(eq(issue.id, id))
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
        .delete(issue)
        .where(eq(issue.id, id))
        .returning();
      return deleted ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

export const Issue = {
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
