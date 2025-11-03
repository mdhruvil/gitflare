import { api } from "@gitvex/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { fetchQuery } from "@/lib/auth-server";

export const getSession = createServerFn().handler(async () => {
  const data = await fetchQuery(api.healthCheck.get, {});
  return data;
});

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-2">
      <pre className="overflow-x-auto font-mono text-sm">GitVex</pre>
      <div className="grid gap-6">
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-medium">API Status</h2>
          <div className="flex items-center gap-2">
            <Button
              onClick={async () => {
                const data = await getSession();
                console.log("Session Data:", data);
              }}
            >
              Check Auth
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
