import { queryOptions } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";

const getSessionFn = createIsomorphicFn()
  .client(async () => {
    const { data } = await authClient.getSession();
    return data;
  })
  .server(async () => {
    const data = await auth.api.getSession({ headers: getRequestHeaders() });
    return data;
  });

export const getSessionOptions = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    const data = await getSessionFn();
    return data;
  },
});
