# Hearth Web

Web UI for [Hearth](../README.md), built with Vite, React, TypeScript, Tailwind CSS v4, and Radix UI.

## Stack

- **Vite** — dev server & build
- **React 19** + **TypeScript**
- **Tailwind CSS v4** — CSS-first config via `@tailwindcss/vite` (no `tailwind.config.js`; customize tokens in `src/index.css` with `@theme`)
- **Radix UI** — unstyled, accessible primitives (`radix-ui` consolidated package)
- **React Router v8** — client-side routing (data-router / `createBrowserRouter`)
- **Data fetching** — typed `fetch` client (`src/lib/api.ts`) + a `useAsync` hook. No polling by design; live updates are intended to arrive over SSE, with `refetch()` for post-mutation refreshes.
- **ESLint** (flat config) + **Prettier** — linting and formatting; Prettier owns formatting and `eslint-config-prettier` disables conflicting ESLint rules

## Development

```bash
bun install        # from this directory
bun run dev        # start the dev server on http://localhost:5173
```

API requests to `/api/*` are proxied to the Hearth backend at `http://localhost:3000`
(configured in `vite.config.ts`), so run the backend separately:

```bash
# from the repo root
docker compose up        # or: bun run src/main.ts
```

## Scripts

| Command                | Description                                   |
| ---------------------- | --------------------------------------------- |
| `bun run dev`          | Start the Vite dev server                     |
| `bun run build`        | Type-check and build for production (`dist/`) |
| `bun run preview`      | Preview the production build                  |
| `bun run typecheck`    | Run the TypeScript compiler                   |
| `bun run lint`         | Lint with ESLint                              |
| `bun run lint:fix`     | Lint and auto-fix                             |
| `bun run format`       | Format all files with Prettier                |
| `bun run format:check` | Check formatting without writing              |

## Layout

```
src/
  main.tsx              # React entry — renders <RouterProvider>
  router.tsx            # Route definitions
  index.css             # Tailwind entry (@import "tailwindcss")
  components/
    Layout.tsx          # App shell: sidebar (agent list + create), <Outlet>
    ui.tsx              # Shared bits: StatusDot, Loading, ErrorMessage
  pages/
    HomePage.tsx        # Index / welcome
    AgentDetailPage.tsx # /agents/:agentId — status, wake, letters, sessions
    SessionPage.tsx     # /agents/:agentId/sessions/:sessionId — transcript
  hooks/
    useAsync.ts         # One-shot fetch + refetch() (no polling)
  lib/
    api.ts              # Typed client for the /api/agents endpoints
    utils.ts            # cn() helper (clsx + tailwind-merge)
```

Routes:

| Path                                   | Page                                                  |
| -------------------------------------- | ----------------------------------------------------- |
| `/`                                    | Welcome / empty state                                 |
| `/agents/:agentId`                     | Agent status, wake button, inbox/outbox, session list |
| `/agents/:agentId/sessions/:sessionId` | Full session transcript                               |

The `@/` import alias maps to `src/`.
