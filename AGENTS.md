# Agent Guidelines for gitflare

Gitflare is a selfhosted GitHub alternative which can be hosted on serverless platforms like Cloudflare Workers.

## Tech stack

- Tanstack Start React
- Cloudflare D1
- Cloudflare Workers
- Cloudflare Durable Objects (SQLite backed) to store git repositories

## IMPORTANT

- Never run `dev` or `build` commands, unless explicitly instructed.
- After making code changes, always run the linter with `pnpm check:fix` to ensure code quality and adherence to guidelines.
- Always fetch latest docs for the library or tool you are working with.
  - For shadcn/ui components, refer to https://ui.shadcn.com/llms.txt for full docs list. You can add `.md` after any docs page URL to get the markdown version. ALWAYS prefer markdown docs. ONLY use `pnpm` to install new components.
  - For other libraries or tools, use context7 mcp server to fetch latest docs.

## Build/Lint/Test Commands

- **Lint**: `pnpm check` (check for issues) or `pnpm check:fix` (check **and** auto-fix)
- **Dev**: `pnpm dev` (runs all workspaces via Turbo)
- **Build**: `pnpm build` (runs all workspaces via Turbo)
- **Web dev**: `cd apps/web && pnpm dev`
- **Deploy web**: `cd apps/web && pnpm deploy` (Cloudflare Workers)
- No test suite currently configured

## Tech Stack

- **Monorepo**: pnpm workspaces with Turbo
- **Frontend**: React 19, TanStack Router, TanStack Query, Vite, Tailwind CSS, Cloudflare Workers
- **Auth**: Better Auth with Cloudflare D1 integration
- **Linting**: Biome via Ultracite preset

## Code Style (Ultracite/Biome)

- **Quotes**: Double quotes for strings
- **TypeScript**: Strict mode, explicit types for params/returns, prefer `unknown` over `any`, use const assertions
- **Imports**: Prefer specific imports, avoid barrel files (index re-exports)
- **Modern JS**: Use `const`/`let`, arrow functions, optional chaining `?.`, nullish coalescing `??`, destructuring
- **React**: Function components, hooks at top level with correct dependencies, semantic HTML with ARIA
- **Error handling**: Throw `Error` objects with messages, early returns over nesting, remove `console.log`/`debugger` from production
- **Naming**: Descriptive names, no magic numbers (extract constants)
