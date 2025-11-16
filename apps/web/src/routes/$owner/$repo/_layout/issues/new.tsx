import { api } from "@gitvex/backend/convex/_generated/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AlertCircleIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { NotFoundComponent } from "@/components/404-components";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchMutation } from "@/lib/auth-server";
import { handleAndThrowConvexError } from "@/lib/convex";

export const Route = createFileRoute("/$owner/$repo/_layout/issues/new")({
  component: RouteComponent,
  notFoundComponent: NotFoundComponent,
});

const formSchema = z.object({
  title: z
    .string()
    .min(1, { message: "Title is required" })
    .max(200, { message: "Title must be less than 200 characters" }),
  body: z.string().max(10_000, {
    message: "Description must be less than 10,000 characters",
  }),
});

const createIssueServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    formSchema.extend({
      fullName: z.string(),
    })
  )
  .handler(async ({ data }) => {
    const issueId = await fetchMutation(api.issues.create, {
      fullName: data.fullName,
      title: data.title,
      body: data.body.trim() || undefined,
    }).catch(handleAndThrowConvexError);

    return { issueId };
  });

type FormValues = z.infer<typeof formSchema>;

function RouteComponent() {
  const navigate = useNavigate();
  const params = Route.useParams();
  const fullName = `${params.owner}/${params.repo}`;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      body: "",
    },
  });

  const createIssueMutation = useMutation({
    mutationFn: async (values: FormValues) =>
      await createIssueServerFn({
        data: {
          ...values,
          fullName,
        },
      }),
    onSuccess: () => {
      toast.success("Issue created successfully!");
      form.reset();
      navigate({
        to: "/$owner/$repo/issues",
        params: {
          owner: params.owner,
          repo: params.repo,
        },
      });
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create issue";
      toast.error(errorMessage);
    },
  });

  const onSubmit = (values: FormValues) => {
    createIssueMutation.mutate({
      ...values,
      body: values.body.trim() || "",
    });
  };

  const isSubmitting = createIssueMutation.isPending;

  return (
    <div className="container mx-auto my-10 px-5 md:px-0">
      <Card className="mx-auto max-w-3xl bg-background">
        <CardHeader>
          <CardTitle>Create a new issue</CardTitle>
        </CardHeader>
        <CardContent>
          {createIssueMutation.error && (
            <Alert className="mb-6" variant="destructive">
              <AlertCircleIcon className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {createIssueMutation.error.message ?? "Failed to create issue"}
              </AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Add a title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Title"
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
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Add a description (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-[200px] resize-y"
                        placeholder="Type your description here..."
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  params={params}
                  to="/$owner/$repo/issues"
                >
                  Cancel
                </Link>
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
