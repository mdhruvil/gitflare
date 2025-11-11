import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GitBranchIcon, LockIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { handleAndThrowConvexError } from "@/lib/convex";

export const Route = createFileRoute("/_layout/$owner")({
  component: RouteComponent,
  loader: async ({ params, context: { queryClient } }) => {
    await queryClient
      .ensureQueryData(
        convexQuery(api.repositories.getByOwner, {
          owner: params.owner,
        })
      )
      .catch(handleAndThrowConvexError);
  },
});

function RouteComponent() {
  const { owner } = Route.useParams();
  const { data } = useSuspenseQuery(
    convexQuery(api.repositories.getByOwner, {
      owner,
    })
  );

  const repositories = data.repos;

  return (
    <div className="py-8">
      <div className="grid gap-8 md:grid-cols-4">
        <div className="col-span-1">
          <Avatar className="mb-4 size-48 rounded-full">
            <AvatarImage
              alt={`@${owner}`}
              src={`https://api.dicebear.com/9.x/notionists/svg?seed=${owner}&scale=150&backgroundType=solid,gradientLinear&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`}
            />
            <AvatarFallback>
              {owner
                .split(" ")
                .map((w) => w.at(0))
                .join("")}
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="font-bold text-2xl">{data.owner?.name}</h2>
            <p className="text-muted-foreground">{data.owner?.username}</p>
          </div>
        </div>
        <div className="col-span-3">
          <h2 className="mb-4 font-semibold text-xl">Repositories</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {repositories.length === 0 ? (
              <p className="text-muted-foreground">No repositories found</p>
            ) : (
              repositories.map((repo) => (
                <Link
                  className="h-full"
                  key={repo._id}
                  params={{ owner: repo.owner, repo: repo.name }}
                  to="/$owner/$repo"
                >
                  <Card className="h-full transition-colors hover:bg-accent">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <GitBranchIcon className="size-4 text-muted-foreground" />
                          <CardTitle>{repo.name}</CardTitle>
                        </div>
                        {repo.isPrivate && (
                          <LockIcon className="size-4 text-muted-foreground" />
                        )}
                      </div>
                      {repo.description && (
                        <CardDescription className="line-clamp-2 text-sm">
                          {repo.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                  </Card>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
