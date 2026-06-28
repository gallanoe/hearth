import { useState, type FormEvent } from "react"
import { NavLink, Outlet } from "react-router"
import { useAsync } from "@/hooks/useAsync"
import { listAgents, createAgent } from "@/lib/api"
import { cn } from "@/lib/utils"
import { StatusDot } from "@/components/ui"

export default function Layout() {
  const { data, error, loading, refetch } = useAsync(() => listAgents(), [])
  const [newId, setNewId] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const id = newId.trim()
    if (!id) return
    setCreating(true)
    setCreateError(null)
    try {
      await createAgent(id)
      setNewId("")
      refetch()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const agents = data?.agents ?? []

  return (
    // Fixed to the viewport: the rail and main scroll independently, so a long
    // transcript never stretches the sidebar with it.
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-5 py-5">
          <NavLink to="/" className="font-serif text-xl tracking-tight">
            Hearth
          </NavLink>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted">
            control room
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 px-2 font-mono text-[11px] uppercase tracking-wider text-muted">
            Agents
          </div>
          {loading && <p className="px-2 text-sm text-muted">Loading…</p>}
          {error && <p className="px-2 text-sm text-alert">{error}</p>}
          {!loading && !error && agents.length === 0 && (
            <p className="px-2 text-sm text-muted">No agents yet.</p>
          )}
          <ul className="space-y-0.5">
            {agents.map((a) => (
              <li key={a.agentId}>
                <NavLink
                  to={`/agents/${a.agentId}`}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-control px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-surface-2 text-text"
                        : "text-muted hover:bg-surface-2/60 hover:text-text",
                    )
                  }
                >
                  <StatusDot awake={a.isRunning} />
                  <span className="truncate">{a.agentId}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <form onSubmit={handleCreate} className="border-t border-line p-3">
          <label className="mb-1.5 block px-1 font-mono text-[11px] uppercase tracking-wider text-muted">
            New agent
          </label>
          <div className="flex gap-2">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="agent-id"
              className="min-w-0 flex-1 rounded-control border border-line bg-base px-2 py-1.5 text-sm text-text outline-none placeholder:text-muted/60 focus:border-muted"
            />
            <button
              type="submit"
              disabled={creating || !newId.trim()}
              className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-text transition-colors hover:border-muted hover:bg-surface-2 disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {createError && (
            <p className="mt-1.5 px-1 text-xs text-alert">{createError}</p>
          )}
        </form>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
