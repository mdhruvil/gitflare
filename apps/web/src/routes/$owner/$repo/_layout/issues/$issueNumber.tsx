import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/$owner/$repo/_layout/issues/$issueNumber"
)({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/$owner/$repo/_layout/issues/$issueNumber"!</div>;
}
