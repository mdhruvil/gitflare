import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { apiKey, username } from "better-auth/plugins";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authSchema from "./betterAuth/schema";

const siteUrl = process.env.SITE_URL ?? "";

export const authComponent = createClient<DataModel>(components.betterAuth, {
  local: {
    // @ts-expect-error idk why is this happening
    schema: authSchema,
  },
});

function createAuth(
  ctx: GenericCtx<DataModel>,
  { optionsOnly }: { optionsOnly?: boolean } = { optionsOnly: false }
) {
  return betterAuth({
    logger: {
      disabled: optionsOnly,
    },
    baseURL: siteUrl,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      convex(),
      username(),
      apiKey({
        enableMetadata: true,
      }),
    ],
  });
}

export { createAuth };

export const getCurrentUser = query({
  args: {},
  returns: v.any(),
  async handler(ctx, _args) {
    return await authComponent.getAuthUser(ctx);
  },
});
