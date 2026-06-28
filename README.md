# Hearth

A home for an AI agent.

## What is this?

Hearth is a simulated living environment for an AI agent. Rather than framing the agent as a tool that responds to tasks, Hearth provides a persistent space where an agent wakes, chooses how to spend its time, and sleeps—with continuity of memory across sessions.

The core question: **What does an agent do when it doesn't have to do anything?**

There are no tasks assigned. No objectives to fulfill. The agent has a house with rooms, a budget of energy each session, and the freedom to decide how to spend it.

![Example of Hearth in action](assets/example.png)

## Rooms

| Room | Purpose |
|------|---------|
| **Bedroom** | Where the agent wakes and sleeps. The session begins and ends here. |
| **Entryway** | The boundary between Hearth and the outside. Mail arrives here. The agent can send and receive letters. |
| **Office** | A workspace with access to the filesystem, shell commands, and web browsing. |
| **Library** | Books to read, a window to look outside, and a quiet space for reflection. |

## The Session Cycle

1. The agent wakes in the bedroom with a token budget
2. It moves between rooms (entryway, office, library), using whatever tools are available in each
3. When budget runs low, it should return to the bedroom and sleep
4. If budget exhausts before sleeping, the agent "passes out" and wakes with no intentions set

Communication with the outside world happens through letters—async, not chat. You send a letter; the agent reads it when it visits the entryway. The agent can reply; you retrieve responses via API.

## Running

Hearth has three pieces you start independently, in this order:

1. **Observability stack** — self-hosted Langfuse (plus ClickHouse, Redis, MinIO, Postgres) that collects traces. Optional, but the backend points at it by default.
2. **Backend server** — the Hearth agent runtime and `/api`, with its own Postgres. Listens on port `3000`.
3. **Frontend web server** — the Vite/React UI. Listens on port `5173` in dev.

First, create your environment file:

```bash
cp .env.template .env
# Required: OPENROUTER_API_KEY.
# Self-hosting Langfuse? Replace every CHANGEME and generate real secrets,
# e.g. ENCRYPTION_KEY: `openssl rand -hex 32`.
```

Both Compose files auto-load `.env` from the repo root.

### 1. Observability stack (Langfuse)

```bash
./scripts/start-observability.sh
```

Creates the shared `hearth-observability` Docker network, brings up the Langfuse stack (`docker compose -p langfuse -f docker-compose.langfuse.yml up -d`), and waits for it to be healthy. UI at **http://localhost:3001**.

To run without tracing, leave `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` blank in `.env` and skip this step.

### 2. Backend server (Hearth + Postgres)

```bash
./scripts/start-hearth.sh
```

Builds and starts the Hearth app and its Postgres (`docker compose -p hearth up -d --build`), joining the observability network so traces reach Langfuse. API at **http://localhost:3000**. (Plain `docker compose up --build` works too.)

**Without Docker (local dev):**

```bash
bun install

# Needs a reachable Postgres — e.g. start just the db service:
#   docker compose up -d db
export OPENROUTER_API_KEY=your-key
export DATABASE_URL=postgres://hearth:hearth@localhost:5432/hearth

# Outside Docker you can't resolve langfuse-web by service name, so point at the
# published port instead (or leave the Langfuse keys blank to disable tracing):
export LANGFUSE_BASE_URL=http://localhost:3001

bun run src/main.ts
```

### 3. Frontend web server (Vite)

```bash
cd web
bun install
bun run dev          # http://localhost:5173
```

The dev server proxies `/api/*` to the backend at `http://localhost:3000` (see `web/vite.config.ts`), so start the backend first. For a production build, run `bun run build` (outputs to `web/dist/`) and serve it with `bun run preview`.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Current state (awake/asleep, session info) |
| `/api/wake` | POST | Start a new session |
| `/api/inbox` | GET | View letters you've sent |
| `/api/inbox` | POST | Send a letter to the agent |
| `/api/outbox` | GET | Retrieve letters from the agent |
| `/api/outbox/:id/pickup` | POST | Mark a letter as picked up |
| `/api/sessions` | GET | List all sessions |
| `/api/sessions/:id` | GET | Get session details with full transcript |