import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import React from "react";
import * as z from "zod";
import { NotFoundComponent } from "@/components/404-components";
import { BranchSelector } from "@/components/branch-selector";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const searchSchema = z.object({
  ref: z.string().optional(),
  path: z.string().optional().default(""),
});

export const Route = createFileRoute("/$owner/$repo/_layout/_viewer")({
  component: RouteComponent,
  validateSearch: searchSchema,
  notFoundComponent: NotFoundComponent,
});

function RouteComponent() {
  const params = Route.useParams();
  const { repo, owner } = params;

  const pathname = useLocation({
    select: (loc) => loc.pathname,
  });
  const navigate = Route.useNavigate();
  const { path, ref } = Route.useSearch();
  const pathParts = path.split("/").filter(Boolean);

  async function onBranchChange(branch: string) {
    const isTreePage = pathname.endsWith("/tree");
    await navigate({
      to: isTreePage ? "/$owner/$repo/tree" : "/$owner/$repo/blob",
      search: {
        path,
        ref: branch,
      },
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link params={params} to="/$owner/$repo">
                  {repo}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {pathParts.map((part, i) => (
              <React.Fragment key={part}>
                <BreadcrumbSeparator>/</BreadcrumbSeparator>
                <BreadcrumbItem>
                  {i === pathParts.length - 1 ? (
                    <BreadcrumbLink>{part}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link
                        params={params}
                        search={{
                          ref,
                          path: pathParts.slice(0, i + 1).join("/"),
                        }}
                        to="/$owner/$repo/tree"
                      >
                        {part}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <BranchSelector
          onBranchChange={onBranchChange}
          owner={owner}
          repo={repo}
          selectedBranch={ref}
        />
      </div>

      {/* We are passing `ref` as a key to re-render the outlet when the branch changes */}
      <Outlet key={ref} />
    </>
  );
}
