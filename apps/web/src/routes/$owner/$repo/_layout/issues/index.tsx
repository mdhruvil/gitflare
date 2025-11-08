import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

const getIssuesQueryOptions = (owner: string, repo: string) =>
  convexQuery(api.issues.getByRepo, {
    fullName: `${owner}/${repo}`,
  });

export const Route = createFileRoute("/$owner/$repo/_layout/issues/")({
  component: RouteComponent,
  loader: async ({ params, context: { queryClient } }) => {
    await queryClient.ensureQueryData(
      getIssuesQueryOptions(params.owner, params.repo)
    );
  },
});

function RouteComponent() {
  const params = Route.useParams();
  const { data } = useSuspenseQuery(
    getIssuesQueryOptions(params.owner, params.repo)
  );
  return <div>{JSON.stringify(data)}</div>;
}
