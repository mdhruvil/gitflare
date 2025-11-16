import { Illustration, NotFound } from "@/components/ui/not-found";

export function NotFoundComponent() {
  return (
    <div className="relative flex min-h-svh w-full flex-col justify-center bg-background p-6 md:p-10">
      <div className="relative mx-auto w-full max-w-5xl">
        <Illustration className="absolute inset-0 w-full text-foreground opacity-[0.04] dark:opacity-[0.03]" />
        <NotFound
          description="Lost, this page is. In another system, it may be."
          title="Page not found"
        />
      </div>
    </div>
  );
}
