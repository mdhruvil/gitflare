import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$owner/$repo/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/$user/$repo/"!</div>;
}
