import { convexQuery } from "@convex-dev/react-query";
import { api } from "@gitvex/backend/convex/_generated/api";
import type { Id } from "@gitvex/backend/convex/_generated/dataModel";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AlertCircleIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { fetchMutation } from "@/lib/auth-server";
import { handleAndThrowConvexError } from "@/lib/convex";

export const Route = createFileRoute("/$owner/$repo/_layout/settings")({
  component: RouteComponent,
});

const formSchema = z.object({
  isPrivate: z.boolean(),
});

const updateRepoServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      repoId: z.string(),
      isPrivate: z.boolean(),
    })
  )
  .handler(async ({ data }) => {
    const resp = await fetchMutation(api.repositories.update, {
      id: data.repoId as Id<"repositories">,
      isPrivate: data.isPrivate,
    }).catch(handleAndThrowConvexError);
    return resp;
  });

type FormValues = z.infer<typeof formSchema>;

function RouteComponent() {
  const { owner, repo } = Route.useParams();

  const { data: repository } = useSuspenseQuery(
    convexQuery(api.repositories.getByOwnerAndName, {
      owner,
      name: repo,
    })
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: {
      isPrivate: repository.isPrivate,
    },
  });

  const updateRepoMutation = useMutation({
    mutationFn: async (values: FormValues) =>
      await updateRepoServerFn({
        data: {
          repoId: repository._id,
          isPrivate: values.isPrivate,
        },
      }),
    onSuccess: () => {
      toast.success("Repository visibility updated successfully!");
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to update repository visibility";
      toast.error(errorMessage);
    },
  });

  const onSubmit = (values: FormValues) => {
    updateRepoMutation.mutate(values);
  };

  const isSubmitting = updateRepoMutation.isPending;
  const hasChanges = form.formState.isDirty;

  return (
    <div className="container mx-auto max-w-3xl px-5 py-8 md:px-0">
      <div className="space-y-6">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">
            Repository Settings
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage your repository settings and visibility
          </p>
        </div>

        <Separator />

        {updateRepoMutation.error && (
          <Alert variant="destructive">
            <AlertCircleIcon className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {updateRepoMutation.error.message ??
                "Failed to update repository"}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          <div className="space-y-2">
            <Label>Repository name</Label>
            <Input disabled value={repository.name} />
            <p className="text-muted-foreground text-sm">
              Repository name cannot be changed
            </p>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              className="resize-none"
              disabled
              rows={3}
              value={repository.description || "No description provided"}
            />
            <p className="text-muted-foreground text-sm">
              Repository description cannot be changed
            </p>
          </div>

          <Separator />

          <Form {...form}>
            <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="isPrivate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Repository visibility</FormLabel>
                    <FormControl>
                      <RadioGroup
                        className="w-full gap-2 md:flex"
                        disabled={isSubmitting}
                        onValueChange={(value) =>
                          field.onChange(value === "private")
                        }
                        value={field.value ? "private" : "public"}
                      >
                        <Label className="flex flex-1 items-start gap-2 rounded-lg border p-3 hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50">
                          <RadioGroupItem value="public" />
                          <div className="flex flex-col gap-1">
                            <p className="text-sm leading-4">Public</p>
                            <p className="text-muted-foreground text-xs">
                              Anyone can see this repository
                            </p>
                          </div>
                        </Label>
                        <Label className="flex flex-1 items-start gap-2 rounded-lg border p-3 hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50">
                          <RadioGroupItem value="private" />
                          <div className="flex flex-col gap-1">
                            <p className="text-sm leading-4">Private</p>
                            <p className="text-muted-foreground text-xs">
                              Only you can see this repository
                            </p>
                          </div>
                        </Label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end">
                <Button
                  disabled={!hasChanges || isSubmitting}
                  loading={isSubmitting}
                  type="submit"
                >
                  Save changes
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
