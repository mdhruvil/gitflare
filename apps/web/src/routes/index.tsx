import { api } from "@gitvex/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { fetchQuery } from "@/lib/auth-server";

export const getSession = createServerFn().handler(async () => {
  const data = await fetchQuery(api.healthCheck.get, {});
  return data;
});

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const verifyApiKey = useMutation(api.privateData.verifyApiKey);
  return (
    <div className="container mx-auto max-w-3xl px-4 py-2">
      <pre className="overflow-x-auto font-mono text-sm">GitVex</pre>
      <div className="grid gap-6">
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-medium">API Status</h2>
          <div className="flex flex-col items-center gap-2">
            <Button
              onClick={async () => {
                const data = await getSession();
                console.log("Session Data:", data);
              }}
            >
              Check Auth
            </Button>
            <Button
              onClick={async () => {
                const { data, error } = await authClient.apiKey.create({
                  name: "test-api-key",
                  prefix: "gvx_",
                  metadata: {
                    username: "mdhruvil",
                  },
                });

                console.log({ data, error });
              }}
            >
              Create API Keys
            </Button>
            <Button
              onClick={async () => {
                const data = await verifyApiKey({
                  apiKey:
                    "gvx_jfhydxtlusgWyWxRzRdjdmtxfylwWroIjGKQywqftgGfWrpOJYYsDeLgxUHdRJdl",
                });

                console.log({ data });
              }}
            >
              Verify API Key
            </Button>
            <Button
              onClick={async () => {
                const { data, error } = await authClient.apiKey.list();
                console.log({ data, error });
              }}
            >
              List API Keys
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
