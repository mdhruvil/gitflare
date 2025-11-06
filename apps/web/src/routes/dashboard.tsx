import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useState } from "react";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import UserMenu from "@/components/user-menu";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(convexQuery(api.privateData.get, {}));
    console.log("Dashboard loader executed");
  },
});

function RouteComponent() {
  const [showSignIn, setShowSignIn] = useState(false);
  const { data: privateData } = useSuspenseQuery(
    convexQuery(api.privateData.get, {})
  );

  return (
    <>
      <Authenticated>
        <div>
          <h1>Dashboard</h1>
          <p>privateData: {privateData?.message}</p>
          <UserMenu />
        </div>
      </Authenticated>
      <Unauthenticated>
        {showSignIn ? (
          <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
        )}
      </Unauthenticated>
      <AuthLoading>
        <div>Loading...</div>
      </AuthLoading>
    </>
  );
}
