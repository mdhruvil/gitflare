import { api } from "@gitvex/backend/convex/_generated/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AlertCircleIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { getRepoDOStub } from "@/do/repo";
import { fetchMutation } from "@/lib/auth-server";
import { handleAndThrowConvexError } from "@/lib/convex";

export const Route = createFileRoute("/new")({
  component: RouteComponent,
});

const formSchema = z.object({
  name: z
    .string()
    .min(1, { message: "Repository name is required" })
    .max(100, { message: "Repository name must be less than 100 characters" })
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message:
        "Repository name can only contain letters, numbers, hyphens, and underscores",
    }),
  description: z
    .string()
    .max(500, { message: "Description must be less than 500 characters" }),
  isPrivate: z.boolean(),
});

const createRepoServerFn = createServerFn({ method: "POST" })
  .inputValidator(formSchema)
  .handler(async ({ data }) => {
    const resp = await fetchMutation(api.repositories.create, {
      name: data.name,
      description: data.description.trim() || undefined,
      isPrivate: data.isPrivate,
    }).catch(handleAndThrowConvexError);

    const stub = getRepoDOStub(resp.fullName);
    await stub.ensureRepoInitialized();
    return resp;
  });

type FormValues = z.infer<typeof formSchema>;

function RouteComponent() {
  const navigate = useNavigate();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      isPrivate: false,
    },
  });

  const createRepoMutation = useMutation({
    mutationFn: async (values: FormValues) =>
      await createRepoServerFn({
        data: values,
      }),
    onSuccess: ({ owner, name }) => {
      toast.success("Repository created successfully!");
      form.reset();
      navigate({
        to: "/$owner/$repo",
        params: {
          owner,
          repo: name,
        },
      });
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create repository";
      toast.error(errorMessage);
    },
  });

  const onSubmit = (values: FormValues) => {
    createRepoMutation.mutate({
      ...values,
      description: values.description.trim() || "",
    });
  };

  const isSubmitting = createRepoMutation.isPending;

  return (
    <div className="container mx-auto my-10 px-5 md:px-0">
      <Card className="mx-auto max-w-xl bg-background">
        <CardHeader>
          <CardTitle>Create a new repository</CardTitle>
          <CardDescription>
            A repository contains all project files, including the revision
            history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {createRepoMutation.error && (
            <Alert className="mb-6" variant="destructive">
              <AlertCircleIcon className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {createRepoMutation.error.message ??
                  "Failed to create repository"}
              </AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Repository name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="my-awesome-project"
                        {...field}
                        disabled={isSubmitting}
                        onChange={(e) => {
                          const formatted = e.target.value
                            .replace(/\s+/g, "-")
                            .replace(/[^a-zA-Z0-9_-]/g, "");
                          field.onChange(formatted);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        className="resize-none"
                        placeholder="A brief description of your project"
                        {...field}
                        disabled={isSubmitting}
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
                    <FormLabel>Visibility</FormLabel>
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
                <Button loading={isSubmitting} type="submit">
                  Create
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
