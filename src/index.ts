const server = Bun.serve({
  port: 3000,

  routes: {
    "/api/status": {
      GET: () => Response.json({ status: "awake", room: "bedroom" }),
    },

    "/api/messages": {
      GET: () => {
        // TODO: fetch from inbox
        return Response.json({ messages: [] })
      },
      POST: async (req) => {
        const body = await req.json() as { content: string }
        // TODO: persist to inbox
        return Response.json({ received: true, content: body.content })
      },
    },

    "/api/days/:id": {
      GET: (req) => {
        // TODO: fetch day log from db
        return Response.json({ id: req.params.id, turns: [] })
      },
    },

    "/api/*": Response.json({ message: "Not found" }, { status: 404 }),
  },

  fetch(req) {
    return new Response("Not found", { status: 404 })
  },
})

console.log(`Hearth listening on port ${server.port}`)
