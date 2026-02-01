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

The recommended way to run Hearth is with Docker Compose:

```bash
# Set your OpenRouter API key
export OPENROUTER_API_KEY=your-key

# Start Hearth and Postgres
docker compose up
```

This starts the Hearth server on port 3000 with a Postgres database for persistence.

### Running without Docker

Note this hasn't been tested in a while.

```bash
# Install dependencies
bun install

# Set environment variables
export OPENROUTER_API_KEY=your-key
export DATABASE_URL=postgres://user:password@localhost:5432/hearth

# Start the server
bun run src/index.ts
```

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