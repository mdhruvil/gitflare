import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { PlusIcon } from "lucide-react";
import { getSessionOptions } from "@/api/session";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { Skeleton } from "./ui/skeleton";

export function UserProfileButton() {
  const { data, isLoading } = useQuery(getSessionOptions);

  if (isLoading) {
    return <Skeleton className="h-10 w-10 rounded-full" />;
  }

  const user = data?.user;

  return (
    <>
      <Authenticated>
        <div className="flex items-center gap-6">
          <Link className={buttonVariants({ variant: "outline" })} to="/new">
            <PlusIcon /> New
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="relative h-10 w-10 rounded-full"
                variant="ghost"
              >
                <Avatar className="h-10 w-10">
                  <AvatarImage
                    alt={`@${user?.username}`}
                    src={`https://api.dicebear.com/9.x/notionists/svg?seed=${user?.username}&scale=150&backgroundType=solid,gradientLinear&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`}
                  />
                  <AvatarFallback>
                    {user?.name
                      .split(" ")
                      .map((w) => w.at(0))
                      .join("")}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="font-medium text-sm leading-none">
                    {user?.name}
                  </p>
                  <p className="text-muted-foreground text-xs leading-none">
                    {user?.username}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/dashboard">Dashboard</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link params={{ owner: user?.username ?? "" }} to="/$owner">
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await authClient.signOut();
                  window.location.href = "/";
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Authenticated>
      <AuthLoading>
        <Skeleton className="h-10 w-10 rounded-full" />
      </AuthLoading>
      <Unauthenticated>
        <Link className={buttonVariants({ size: "sm" })} to="/login">
          Sign In
        </Link>
      </Unauthenticated>
    </>
  );
}
