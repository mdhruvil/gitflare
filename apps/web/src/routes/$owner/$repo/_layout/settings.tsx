import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import {
  getRepoByOwnerAndNameOpts,
  updateRepoFn,
  updateRepoSchema,
} from "@/api/repos";
import { getSessionOptions } from "@/api/session";
import { NotFoundComponent } from "@/components/404-components";
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

export const Route = createFileRoute("/$owner/$repo/_layout/settings")({
  component: RouteComponent,
  notFoundComponent: NotFoundComponent,
});

const formSchema = updateRepoSchema.omit({ id: true });

type FormValues = z.infer<typeof formSchema>;

function RouteComponent() {
  const { owner, repo } = Route.useParams();

  const { data: repository } = useSuspenseQuery(
    getRepoByOwnerAndNameOpts({
      owner,
      name: repo,
    })
  );
  const { data: session } = useSuspenseQuery(getSessionOptions);

  const isOwner = session?.user.id === repository?.ownerId;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: {
      description: repository.description ?? "",
      isPrivate: repository.isPrivate,
    },
  });

  const updateRepoMutation = useMutation({
    mutationFn: async (values: FormValues) =>
      await updateRepoFn({
        data: {
          id: repository.id,
          description: values.description,
          isPrivate: values.isPrivate,
        },
      }),
    onSuccess: () => {
      toast.success("Repository settings updated successfully!");
    },
    onError: (err) => {
      console.error("Error updating repository:", err);
      toast.error(err.message);
    },
  });

  const onSubmit = (values: FormValues) => {
    updateRepoMutation.mutate(values);
  };

  const isSubmitting = updateRepoMutation.isPending;
  const hasChanges = form.formState.isDirty;

  if (!isOwner) {
    return <Navigate params={{ owner, repo }} to="/$owner/$repo" />;
  }

  return (
    <div>
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

          <Separator />

          <Form {...form}>
            <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        className="resize-none"
                        disabled={isSubmitting}
                        placeholder="Add a description for your repository"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
