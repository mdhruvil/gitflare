import { and, eq } from "drizzle-orm";
import * as z from "zod";
import { DatabaseError } from "@/lib/errors";
import { fn } from "@/lib/fn";
import { Result } from "@/lib/result";
import { db } from ".";
import { repository } from "./schema";

const getById = fn(z.object({ id: z.number() }), ({ id }) =>
  Result.tryCatchAsync(
    async () => {
      const repo = await db.query.repository.findFirst({
        where: eq(repository.id, id),
      });
      return repo ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const getByOwner = fn(z.object({ owner: z.string() }), ({ owner }) =>
  Result.tryCatchAsync(
    async () => {
      const repos = await db.query.repository.findMany({
        where: eq(repository.owner, owner),
      });
      return repos;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const getByOwnerId = fn(z.object({ ownerId: z.string() }), ({ ownerId }) =>
  Result.tryCatchAsync(
    async () => {
      const repos = await db.query.repository.findMany({
        where: eq(repository.ownerId, ownerId),
      });
      return repos;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const getByOwnerAndName = fn(
  z.object({ owner: z.string(), name: z.string() }),
  ({ owner, name }) =>
    Result.tryCatchAsync(
      async () => {
        const repo = await db.query.repository.findFirst({
          where: and(eq(repository.owner, owner), eq(repository.name, name)),
        });
        return repo ?? null;
      },
      (e) =>
        new DatabaseError({
          cause: e,
        })
    )
);

const create = fn(
  z.object({
    ownerId: z.string(),
    owner: z.string(),
    name: z.string(),
    description: z.string().optional(),
    isPrivate: z.boolean().optional().default(false),
  }),
  ({ ownerId, owner, name, description, isPrivate }) =>
    Result.tryCatchAsync(
      async () => {
        const [repo] = await db
          .insert(repository)
          .values({ ownerId, owner, name, description, isPrivate })
          .returning();
        return repo;
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
    name: z.string().optional(),
    description: z.string().optional(),
    isPrivate: z.boolean().optional(),
    ownerId: z.string(),
  }),
  ({ id, name, description, isPrivate, ownerId }) =>
    Result.tryCatchAsync(
      async () => {
        const updates: Partial<{
          name: string;
          description: string;
          isPrivate: boolean;
        }> = {};

        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (isPrivate !== undefined) updates.isPrivate = isPrivate;

        const [repo] = await db
          .update(repository)
          .set(updates)
          .where(and(eq(repository.id, id), eq(repository.ownerId, ownerId)))
          .returning();
        return repo ?? null;
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
        .delete(repository)
        .where(eq(repository.id, id))
        .returning();
      return deleted ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

export const Repo = {
  getById,
  getByOwner,
  getByOwnerId,
  getByOwnerAndName,
  create,
  update,
  remove,
};
