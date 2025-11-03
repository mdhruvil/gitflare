import { setupFetchClient } from "@convex-dev/better-auth/react-start";
import { createAuth } from "@gitvex/backend/convex/auth";
import { getCookie } from "@tanstack/react-start/server";

export const { fetchQuery, fetchMutation, fetchAction } =
  await setupFetchClient(createAuth, getCookie);
