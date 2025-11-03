import { query } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

export const get = query({
  handler: async (ctx) => {
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    const data = await auth.api.getSession({
      headers,
    });
    return data;
  },
});
