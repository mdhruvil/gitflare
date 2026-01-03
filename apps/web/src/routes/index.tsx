import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, GitBranchIcon } from "lucide-react";
import { NotFoundComponent } from "@/components/404-components";
import { GitHubIcon } from "@/components/github";
import { buttonVariants } from "@/components/ui/button";
import { UserProfileButton } from "@/components/user-profile-button";

export const Route = createFileRoute("/")({
  component: HomeComponent,
  notFoundComponent: NotFoundComponent,
});

function HomeComponent() {
  return (
    <main className="mx-auto mb-30 max-w-11/12 border border-x md:max-w-6xl">
      <div className="sticky top-0 border-b bg-background">
        <nav className="mx-auto max-w-5xl p-4">
          <div className="flex items-center justify-between">
            <Link className="flex items-center gap-3" to="/">
              <GitBranchIcon className="size-5" />
              <span className="font-semibold text-lg">GitVex</span>
            </Link>
            <UserProfileButton />
          </div>
        </nav>
      </div>
      <div className="border-b">
        <section className="mx-auto max-w-5xl space-y-6 px-4 py-20 sm:py-30">
          <div className="space-y-4">
            <h1 className="font-semibold text-2xl sm:text-4xl">
              Git Hosting Reimagined
            </h1>
            <p className="max-w-2/3 text-muted-foreground text-sm leading-relaxed sm:text-base">
              GitVex is a fully open-source serverless git hosting platform. No
              VMs, No Containers, Just Durable Objects.
            </p>
          </div>
          <div className="flex gap-3">
            <Link className={buttonVariants()} to="/dashboard">
              Get Started
              <ArrowRightIcon />
            </Link>
            <a
              className={buttonVariants({ variant: "outline" })}
              href="https://github.com/mdhruvil/gitvex"
              rel="noopener noreferrer"
              target="_blank"
            >
              <GitHubIcon />
              GitHub
            </a>
          </div>
          <div className="my-14">
            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between border-b bg-card px-3 py-1.5">
                <span className="text-sm">bash</span>
              </div>

              <HeroCodeBlock />
            </div>
          </div>
        </section>
      </div>
      <div className="border-b">
        <section className="mx-auto my-10 max-w-5xl space-y-6 px-4 sm:my-20">
          <p className="text-xl">What is GitVex ?</p>
          <h3 className="text-pretty text-lg text-muted-foreground">
            GitVex is a fully open-source serverless git hosting platform. Built
            on top of Cloudflare Workers, Durable Objects.
          </h3>
          <div className="space-y-2 leading-relaxed">
            <FeatureRow
              description="No VMs, No Containers, Just Durable Objects"
              feature="Serverless Architecture"
            />
            <FeatureRow
              description="Create unlimited public and private repositories."
              feature="Unlimited Repositories"
            />
            <FeatureRow
              description="Track bugs, features, and manage code reviews. Pull requests coming soon!"
              feature="Issues & Pull Requests(soon)"
            />
            <FeatureRow
              description="Powered by Cloudflare's global network for low latency and high availability."
              feature="On Edge"
            />
            <FeatureRow
              description="Easily manage your repositories with a user-friendly web interface."
              feature="Web Interface"
            />
            <FeatureRow
              description="Completely open-source under the MIT License."
              feature="Open Source"
            />
          </div>
        </section>
      </div>

      <div className="border-b">
        <section className="mx-auto my-10 max-w-5xl space-y-6 px-4 sm:my-20">
          <p className="text-xl">Built With</p>

          <div className="space-y-2 leading-relaxed">
            <TechRow
              description="To handle Git smart HTTP protocol requests and hosting the web interface."
              href="https://developers.cloudflare.com/workers/"
              title="Cloudflare Workers"
            />
            <TechRow
              description="To store and manage Git repository data."
              href="https://developers.cloudflare.com/durable-objects/"
              title="Cloudflare Durable Objects"
            />
            <TechRow
              description="To store user data, repository metadata, issues, and other metadata."
              href="https://developers.cloudflare.com/d1/"
              title="Cloudflare D1"
            />
            <TechRow
              description="For handeling authentication and authorization."
              href="https://www.better-auth.com/"
              title="Better Auth"
            />
            <TechRow
              description="As a framework for building the web interface."
              href="https://tanstack.com/start/latest"
              title="Tanstack Start"
            />
          </div>
        </section>
      </div>

      <section className="mx-auto items-center max-sm:divide-y sm:flex sm:divide-x">
        <a
          className="flex h-30 w-full grow items-center justify-center gap-3 text-lg underline-offset-8 hover:bg-accent hover:underline"
          href="https://github.com/mdhruvil/gitvex"
          rel="noopener noreferrer"
          target="_blank"
        >
          Give a Star <GitHubIcon className="size-5" />
        </a>
        <Link
          className="flex h-30 w-full grow items-center justify-center gap-3 text-lg underline-offset-8 hover:bg-accent hover:underline"
          to="/dashboard"
        >
          Get Started <ArrowRightIcon className="size-5" />
        </Link>
      </section>
    </main>
  );
}

function FeatureRow({
  feature,
  description,
}: {
  feature: string;
  description: string;
}) {
  return (
    <div>
      <span className="font-mono text-muted-foreground"> - [x] </span>
      <span className="font-semibold">{feature}</span> -{" "}
      <span className="text-muted-foreground">{description}</span>
    </div>
  );
}

function TechRow({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <div>
      <span className="font-mono text-muted-foreground"> - [x] </span>
      <a
        className="font-semibold underline underline-offset-6"
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {title}
      </a>{" "}
      - <span className="text-muted-foreground">{description}</span>
    </div>
  );
}

function HeroCodeBlock() {
  return (
    <div className="shiki-wrapper text-sm leading-relaxed">
      <pre
        className="shiki github-dark-default overflow-x-auto bg-transparent p-4"
        style={{ color: "#e6edf3" }}
      >
        <code>
          <span className="line" data-line={1}>
            <span style={{ color: "#FFA657" }}>git</span>
            <span style={{ color: "#A5D6FF" }}> remote</span>
            <span style={{ color: "#A5D6FF" }}> add</span>
            <span style={{ color: "#A5D6FF" }}> origin</span>
            <span style={{ color: "#A5D6FF" }}>
              {" "}
              https://gitvex.mdhruvil.page/username/repo.git
            </span>
            <span style={{ color: "#E6EDF3" }}> </span>
          </span>
          {"\n"}
          <span className="line" data-line={2}>
            <span style={{ color: "#FFA657" }}>git</span>
            <span style={{ color: "#A5D6FF" }}> branch</span>
            <span style={{ color: "#79C0FF" }}> -M</span>
            <span style={{ color: "#A5D6FF" }}> main</span>
          </span>
          {"\n"}
          <span className="line" data-line={3}>
            <span style={{ color: "#FFA657" }}>git</span>
            <span style={{ color: "#A5D6FF" }}> push</span>
            <span style={{ color: "#79C0FF" }}> -u</span>
            <span style={{ color: "#A5D6FF" }}> origin</span>
            <span style={{ color: "#A5D6FF" }}> main</span>
          </span>
          {"\n"}
          <span data-line={4} />
        </code>
      </pre>
    </div>
  );
}
