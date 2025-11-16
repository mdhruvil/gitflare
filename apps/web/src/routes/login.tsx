import { createFileRoute } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";
import { NotFoundComponent } from "@/components/404-components";
import SignInForm from "@/components/sign-in-form";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
  notFoundComponent: NotFoundComponent,
});

function RouteComponent() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a className="flex items-center gap-2 self-center font-medium" href="/">
          <GitBranchIcon />
          GitVex
        </a>
      </div>
      <SignInForm />
    </div>
  );
}
