import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";
import * as authSchema from "./schema/auth";
import * as relations from "./schema/relations";

export const db = drizzle(env.DB, {
  schema: {
    ...authSchema,
    ...schema,
    ...relations,
  },
});
