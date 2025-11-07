// src/start.ts
import { createStart } from "@tanstack/react-start";
import { sentryServerFnMiddleware } from "./sentry";

export const startInstance = createStart(() => ({
  functionMiddleware: [sentryServerFnMiddleware],
}));
