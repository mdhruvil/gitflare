import { eq } from "drizzle-orm";
import * as z from "zod";
import { DatabaseError } from "@/lib/errors";
import { fn } from "@/lib/fn";
import { Result } from "@/lib/result";
import { db } from ".";
import { user } from "./schema/auth";

const getById = fn(z.object({ id: z.string() }), ({ id }) =>
  Result.tryCatchAsync(
    async () => {
      const result = await db.query.user.findFirst({
        where: eq(user.id, id),
      });
      return result ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const getByUsername = fn(z.object({ username: z.string() }), ({ username }) =>
  Result.tryCatchAsync(
    async () => {
      const result = await db.query.user.findFirst({
        where: eq(user.username, username),
      });
      return result ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

const getByEmail = fn(z.object({ email: z.string() }), ({ email }) =>
  Result.tryCatchAsync(
    async () => {
      const result = await db.query.user.findFirst({
        where: eq(user.email, email),
      });
      return result ?? null;
    },
    (e) =>
      new DatabaseError({
        cause: e,
      })
  )
);

export const User = {
  getById,
  getByUsername,
  getByEmail,
};
