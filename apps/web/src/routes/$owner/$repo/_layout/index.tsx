import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/$owner/$repo/_layout/")({
  component: RouteComponent,
});

function RouteComponent() {
  const params = Route.useParams();
  const { owner, repo } = params;

  return (
    <Navigate
      params={{ owner, repo }}
      search={{ ref: "main", path: "" }}
      to="/$owner/$repo/tree"
    />
  );
}
