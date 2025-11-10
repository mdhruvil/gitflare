import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$owner/$repo/_layout/pulls")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="text-center text-xl">
      TODO - Maybe I can't even implement this on time.
    </div>
  );
}
