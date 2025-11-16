# Gitvex

A self-hosted GitHub alternative built to run on serverless platforms. Built on top of Cloudflare Workers, Durable Objects and Convex.

Visit [https://gitvex.mdhruvil.page/mdhruvil/gitvex](https://gitvex.mdhruvil.page/mdhruvil/gitvex) to view GitVex repository on GitVex itself.

## Features

- **Serverless Architecture** - No VMs, No Containers, Just Durable Objects and Convex
- **Unlimited Repositories** - Create unlimited public and private repositories
- **Issues & Pull Requests(soon)** - Track bugs, features, and manage code reviews. Pull requests coming soon!
- **On Edge** - Powered by Cloudflare's global network for low latency and high availability
- **Web Interface** - Easily manage your repositories with a user-friendly web interface
- **Open Source** - Completely open-source under the MIT License

## Tech Stack

- **[Tanstack Start](https://tanstack.com/start/latest)** - As a framework for building the web interface
- **[Convex](https://www.convex.dev/)** - To store user data, repository metadata, issues, and other metadata
- **[Cloudflare Workers](https://developers.cloudflare.com/workers/)** - To handle Git smart HTTP protocol requests and hosting the web interface
- **[Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)** - To store and manage Git repository data
- **[Better Auth](https://www.better-auth.com/)** - For handling authentication and authorization

## How It Works

GitVex reimagines Git hosting with a fully serverless architecture. Here's how the pieces fit together:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Git Client (You)                           │
│                     git push / git pull / git clone                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Cloudflare Workers (Edge)                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              TanStack Start Application                       │  │
│  │                                                               │  │
│  │  • Authentication & Authorization                             │  │
│  │  • HTTP Handlers for Git Smart Protocol                       │  │
│  │    - git-upload-pack (fetch/pull)                             │  │
│  │    - git-receive-pack (push)                                  │  │
│  │    - Pkt-line protocol parsing                                │  │
│  │    - Packfile creation & transfer                             │  │
│  │  • Web UI                                                     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────┬────────────────────────────┬─────────────────────┘
                   │                            │
                   │ Git Operations             │ Metadata Queries
                   ▼                            ▼
┌──────────────────────────────────┐  ┌─────────────────────────────┐
│   Cloudflare Durable Objects     │  │         Convex              │
│                                  │  │                             │
│  ┌────────────────────────────┐  │  │  • User Accounts            │
│  │  Virtualized File System   │  │  │  • Repository Metadata      │
│  │    (Built on DO SQLite)    │  │  │  • Issues & Comments        │
│  │                            │  │  │  • Real-time Subscriptions  │
│  │  • Git Objects Storage     │  │  └─────────────────────────────┘
│  │  • Packfile Operations     │  │
│  └────────────────────────────┘  │
│                                  │
│  (One Durable Object per Repo)   │
└──────────────────────────────────┘
```

### The Flow

**1. Git Protocol Handling**

When you interact with a GitVex repository using standard Git commands, the request hits **HTTP handlers in the TanStack Start application**. These handlers implement the Git Smart HTTP protocol, translating Git's wire protocol into operations that can be executed against the repository storage. The entire TanStack Start app runs on **Cloudflare Workers**, deployed globally at the edge for minimal latency.

**2. Repository Data Storage**

Git repository data including all objects (blobs, trees, commits, tags), references (branches, tags), and packfiles are stored in **Cloudflare Durable Objects**. Each repository gets its own isolated Durable Object instance with a **virtualized file system built on top of Durable Object SQLite storage**.

**3. Metadata & Coordination**

User data, repository metadata, issues, pull requests, and access control information live in **Convex**. This separation allows the web interface to provide real-time reactive updates, efficient querying, and type-safe operations without impacting Git protocol performance. Convex also integrates with Better Auth to handle authentication seamlessly.

## Project Structure

```
gitvex/
├── apps/
│   └── web/                    # TanStack Start app deployed on Cloudflare Workers
│                               # Contains Git Smart HTTP Protocol handlers, Durable
│                               # Object implementations, Web UI, and routing
└── packages/
    └── backend/
        └── convex/            # Convex backend with database schema, repository
                               # metadata, issues, pull requests, Better Auth adapter
```

## Prerequisites

- **Node.js**: v22 or higher
- **pnpm**: v10.19.0 or higher (this project uses pnpm workspaces)
- **Cloudflare Account**: Required for deployment (free tier works)
- **Convex Account**: Required for backend (free tier works)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/mdhruvil/gitvex.git
cd gitvex
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Set Up Convex Backend

This project uses Convex as its backend. You need to set up Convex before running the app:

```bash
cd packages/backend
pnpm dev:setup
```

This command will:

- Create a new Convex project (or link to an existing one)
- Configure your Convex backend
- Generate the necessary environment variables

Follow the prompts to authenticate and create your Convex project.

### 4. Configure Environment Variables

Copy the environment file generated by Convex in the web app:

```bash
cp packages/backend/.env.local apps/web/.env
```

Edit `.env` and rename the `CONVEX_URL` variable to `VITE_CONVEX_URL`:

```env
VITE_CONVEX_URL=https://your-project.convex.cloud
```

Set Convex environment variables

```bash
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:3000
```

### 5. Start Development Servers

From the **root** directory:

```bash
pnpm dev
```

### 6. Access the Application

Open your browser and navigate to:

[http://localhost:3000](http://localhost:3000)

## Development

### Available Scripts

**Root Level:**

- `pnpm dev` - Start all applications in development mode (Turborepo)
- `pnpm build` - Build all applications
- `pnpm check` - Run Biome linting and formatting checks
- `pnpm check:fix` - Run Biome and auto-fix issues (run this after making code changes)

**Web App (apps/web):**

- `pnpm dev` - Start the web development server (Vite)
- `pnpm build` - Build the web application
- `pnpm serve` - Preview production build locally
- `pnpm deploy` - Deploy to Cloudflare Workers
- `pnpm cf-typegen` - Generate TypeScript types for Cloudflare Workers

**Backend (packages/backend):**

- `pnpm dev` - Start Convex backend in development mode
- `pnpm dev:setup` - Set up and configure Convex project

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and run `pnpm check:fix`
4. Commit your changes: `git commit -m 'Add my feature'`
5. Push to the branch: `git push origin feature/my-feature`
6. Submit a pull request

## License

MIT

## Acknowledgments

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack combining React, TanStack Start, Convex, and more.

## Support

For issues and questions:

- Open an issue on GitHub
- Check the [Convex documentation](https://docs.convex.dev/)
- Check the [TanStack documentation](https://tanstack.com/)
- Check the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
