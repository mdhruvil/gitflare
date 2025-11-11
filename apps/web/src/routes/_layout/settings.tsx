import { useForm } from "@tanstack/react-form";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";
import { listPersonalAccessTokens } from "@/api/pat";
import { getSessionOptions } from "@/api/session";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { handleAndThrowConvexError } from "@/lib/convex";

export const Route = createFileRoute("/_layout/settings")({
  component: RouteComponent,
  loader: async ({ context: { queryClient } }) => {
    await queryClient
      .ensureQueryData(getSessionOptions)
      .catch(handleAndThrowConvexError);
  },
  pendingComponent: PendingComponent,
});

function PendingComponent() {
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <h1 className="mb-6 font-bold text-3xl">Settings</h1>

      <Tabs defaultValue="profile" onChange={() => {}} value="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="tokens">Personal Access Tokens</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="rounded-lg border p-6">
            <Skeleton className="mb-6 h-6 w-40" />

            <div className="mb-6 flex items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-10 w-28" />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RouteComponent() {
  const { data: session, isLoading } = useSuspenseQuery(getSessionOptions);

  if (isLoading) {
    return <PendingComponent />;
  }

  const user = session?.user;

  return (
    <>
      <Authenticated>
        <div className="mx-auto w-full max-w-4xl p-6">
          <h1 className="mb-6 font-bold text-3xl">Settings</h1>

          <Tabs defaultValue="profile">
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="tokens">Personal Access Tokens</TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <ProfileSettings
                email={user?.email ?? "NO_EMAIL"}
                name={user?.name ?? "NO_NAME"}
                username={user?.username ?? "NO_USERNAME"}
              />
            </TabsContent>

            <TabsContent value="tokens">
              <PersonalAccessTokens />
            </TabsContent>
          </Tabs>
        </div>
      </Authenticated>
      <Unauthenticated>
        <Navigate to="/" />
      </Unauthenticated>
      <AuthLoading>
        <PendingComponent />
      </AuthLoading>
    </>
  );
}

type ProfileSettingsProps = {
  name: string;
  email: string;
  username: string;
};

function ProfileSettings({ name, email, username }: ProfileSettingsProps) {
  const queryClient = useQueryClient();

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      const result = await authClient.updateUser({
        name: data.name,
      });
      if (result.error) {
        throw new Error(result.error.message || "Failed to update profile");
      }
      await queryClient.refetchQueries({
        queryKey: getSessionOptions.queryKey,
      });
      return result.data;
    },
    onSuccess: async () => {
      toast.success("Profile updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update profile");
    },
  });

  const form = useForm({
    defaultValues: {
      name,
    },
    onSubmit: async ({ value }) => {
      await updateProfileMutation.mutateAsync(value);
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
      }),
    },
  });

  return (
    <div className="rounded-lg border p-6">
      <h2 className="mb-6 font-semibold text-lg">Profile Information</h2>

      <div className="mb-6 flex items-center gap-4">
        <Avatar className="h-20 w-20">
          <AvatarImage
            alt={`@${username}`}
            src={`https://api.dicebear.com/9.x/notionists/svg?seed=${username}&scale=150&backgroundType=solid,gradientLinear&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`}
          />
          <AvatarFallback>
            {name
              .split(" ")
              .map((w) => w.at(0))
              .join("")}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium text-lg">{name}</p>
          <p className="text-muted-foreground text-sm">@{username}</p>
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <div>
          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Name</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={name}
                  value={field.state.value}
                />
                {field.state.meta.errors.map((error) => (
                  <p className="text-red-500 text-sm" key={error?.message}>
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input disabled id="username" value={username} />
          <p className="text-muted-foreground text-xs">
            Username cannot be changed
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input disabled id="email" type="email" value={email} />
          <p className="text-muted-foreground text-xs">
            Email cannot be changed
          </p>
        </div>
        <Button loading={updateProfileMutation.isPending} type="submit">
          Save Changes
        </Button>
      </form>
    </div>
  );
}

function PersonalAccessTokens() {
  const { data, isLoading } = useQuery(listPersonalAccessTokens);
  const queryClient = useQueryClient();

  const [showNewTokenDialog, setShowNewTokenDialog] = useState(false);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(
    null
  );
  const [isCopied, setIsCopied] = useState(false);

  const createPATMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await authClient.apiKey.create({
        name,
        prefix: "gvx_",
      });
      if (error) {
        throw new Error(
          error.message || "Failed to create personal access token"
        );
      }
      return data;
    },
    onSuccess: async (data) => {
      await queryClient.refetchQueries({
        queryKey: listPersonalAccessTokens.queryKey,
      });
      setNewlyCreatedToken(data.key);
      setShowNewTokenDialog(false);
      toast.success("Personal access token created successfully");
    },
    onError: (error) => {
      console.log(error);
      toast.error(error.message || "Failed to create personal access token");
    },
  });

  const form = useForm({
    defaultValues: {
      name: "",
    },
    onSubmit: async ({ value }) => {
      await createPATMutation.mutateAsync(value.name);
      form.reset();
    },
    validators: {
      onSubmit: z.object({
        name: z
          .string()
          .min(3, "Token name must be at least 3 characters")
          .max(50, "Token name must be at most 50 characters"),
      }),
    },
  });

  if (isLoading) {
    return <PersonalAccessTokensSkeleton />;
  }

  const tokens = data || [];

  const handleCopyToken = (token: string) => {
    if (!token) {
      toast.error("No token to copy");
      return;
    }
    navigator.clipboard.writeText(token);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-6">
        <div className="mb-6">
          <h2 className="mb-2 font-semibold text-lg">Personal Access Tokens</h2>
          <p className="text-muted-foreground text-sm">
            Personal access tokens function like passwords for Git over HTTP.
            Use them to authenticate when pushing or pulling repositories.
          </p>
        </div>

        <Button onClick={() => setShowNewTokenDialog(true)}>
          Generate New Token
        </Button>

        {/* Create Token Dialog */}
        <Dialog onOpenChange={setShowNewTokenDialog} open={showNewTokenDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Personal Access Token</DialogTitle>
              <DialogDescription>
                Give your token a descriptive name to help you identify it
                later.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
            >
              <form.Field name="name">
                {(field) => (
                  <div className="space-y-2 py-4">
                    <Label htmlFor={field.name}>Token Name</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="e.g., My Development Token"
                      value={field.state.value}
                    />
                    <p className="text-muted-foreground text-xs">
                      What is this token for?
                    </p>
                    {field.state.meta.errors.map((error) => (
                      <p
                        className="text-destructive text-sm"
                        key={error?.message}
                      >
                        {error?.message}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setShowNewTokenDialog(false);
                    form.reset();
                  }}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button loading={createPATMutation.isPending} type="submit">
                  Generate Token
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {newlyCreatedToken && (
          <div className="my-5">
            <h2 className="font-semibold text-lg">Generated Token</h2>
            <p className="mb-2 text-muted-foreground text-sm">
              Make sure to copy your personal access token now. You won't be
              able to see it again!
            </p>
            <div className="flex items-center gap-2">
              <code className="block overflow-x-auto whitespace-nowrap rounded border bg-muted p-2 font-mono text-sm">
                {newlyCreatedToken}
              </code>

              <Button
                className="shrink-0"
                onClick={() => handleCopyToken(newlyCreatedToken || "")}
                size="icon"
                variant="outline"
              >
                {isCopied ? (
                  <CheckIcon className="size-4 text-green-600" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {tokens.length > 0 && (
        <div className="rounded-lg border p-6">
          <h3 className="mb-4 font-semibold text-base">Your Tokens</h3>
          <div className="space-y-3">
            {tokens.map((token) => (
              <TokenCard
                createdAt={token.createdAt}
                id={token.id}
                key={token.id}
                lastRequest={token.lastRequest}
                name={token.name ?? "Unnamed Token"}
                start={token.start ?? "gvx_xxx"}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const formatDate = (date: Date) =>
  formatDistanceToNow(date, { addSuffix: true });

type TokenCardProps = {
  id: string;
  name: string;
  start: string;
  createdAt: Date;
  lastRequest: Date | null;
};

function TokenCard({
  id,
  name,
  start,
  createdAt,
  lastRequest,
}: TokenCardProps) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const { data, error } = await authClient.apiKey.delete({
        keyId: tokenId,
      });
      if (error || !data.success) {
        throw new Error(
          error?.message || "Failed to delete personal access token"
        );
      }
      await queryClient.refetchQueries({
        queryKey: listPersonalAccessTokens.queryKey,
      });
    },
    onError: (error) => {
      console.log(error);
      toast.error(error.message || "Failed to delete personal access token");
    },
  });
  return (
    <Card className="p-4" key={id}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2">
            <h4 className="font-semibold text-sm">{name}</h4>
          </div>
          <div className="space-y-1 text-muted-foreground text-xs">
            <p>Created: {formatDate(createdAt)}</p>
            <p>Last used: {lastRequest ? formatDate(lastRequest) : "Never"}</p>
            <code className="text-xs">{`${start}.....`}</code>
          </div>
        </div>

        <Button
          loading={deleteMutation.isPending}
          onClick={() => {
            deleteMutation.mutate(id);
          }}
          size="icon"
          variant="outline"
        >
          <Trash2Icon />
        </Button>
      </div>
    </Card>
  );
}

function PersonalAccessTokensSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-6">
        <Skeleton className="mb-2 h-6 w-48" />
        <Skeleton className="mb-6 h-4 w-full max-w-2xl" />
        <Skeleton className="h-10 w-40" />
      </div>

      <div className="rounded-lg border p-6">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="space-y-3">
          <div className="rounded-lg border p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-3">
                <Skeleton className="h-5 w-40" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-3">
                <Skeleton className="h-5 w-36" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
