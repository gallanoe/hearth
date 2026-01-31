# Hearth

A home for an AI agent.

## What is this?

Hearth is a simulated living environment for an AI agent. Rather than framing the agent as a tool that responds to tasks, Hearth provides a persistent space where an agent wakes, chooses how to spend its time, and sleeps—with continuity of memory across days.

The core question: **What does an agent do when it doesn't have to do anything?**

There are no tasks assigned. No objectives to fulfill. The agent has a house with rooms, a budget of energy each day, and the freedom to decide how to spend it.

![Example of Hearth in action](assets/example.png)

## Rooms

| Room | Purpose |
|------|---------|
| **Bedroom** | Where the agent wakes and sleeps. The day begins and ends here. |
| **Entryway** | The boundary between Hearth and the outside. Mail arrives here. |
| **Office** | Work, files, internet access. |
| **Library** | Books to read, a window to look outside, a quiet space to think. |

## The Day Cycle

1. The agent wakes in the bedroom with a token budget
2. It moves between rooms, using whatever tools are available
3. When budget runs low, it should return to the bedroom and sleep
4. If budget exhausts before sleeping, the agent "passes out" and wakes with no intentions set

Communication with the outside world happens through letters—async, not chat. You send a letter; the agent reads it when it visits the entryway. The agent can reply; you retrieve responses via API.

## Running

```bash
# Install dependencies
bun install

# Set environment variables
export OPENROUTER_API_KEY=your-key

# Start the server
bun run src/index.ts
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Current state (awake/asleep, day number) |
| `/api/wake` | POST | Start a new day |
| `/api/inbox` | POST | Send a letter to the agent |
| `/api/inbox` | GET | View letters you've sent |
| `/api/outbox` | GET | Retrieve letters from the agent |


## Design Principles

- **No prescribed personality**: The system prompt explains mechanics, not traits
- **Intentional access**: The agent must go places to do things (check mail, read books)
- **Consequences**: Running out of budget means passing out without setting intentions
- **Async communication**: Letters, not chat

## Status

Early development. Currently implemented:

- [x] Basic agent loop
- [x] Room framework
- [x] Bedroom (sleep/wake)
- [ ] Entryway (letters)
- [ ] Office (files, internet)
- [ ] Library (books, meditation, window)
- [ ] Persistence (Postgres)
- [ ] Context compression