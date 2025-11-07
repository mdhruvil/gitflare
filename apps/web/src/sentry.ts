import * as Sentry from "@sentry/cloudflare";
import { createMiddleware } from "@tanstack/react-start";

export const sentryServerFnMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  try {
    const result = await next();
    return result;
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  }
});
