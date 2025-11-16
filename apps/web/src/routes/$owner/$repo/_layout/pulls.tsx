import { createFileRoute } from "@tanstack/react-router";
import { NotFoundComponent } from "@/components/404-components";

export const Route = createFileRoute("/$owner/$repo/_layout/pulls")({
  component: RouteComponent,
  notFoundComponent: NotFoundComponent,
});

function RouteComponent() {
  return (
    <div className="text-center text-xl">
      TODO - Maybe I can't even implement this on time.
    </div>
  );
}
