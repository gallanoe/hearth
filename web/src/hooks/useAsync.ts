import { useCallback, useEffect, useState, type DependencyList } from "react"

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  refetch: () => void
}

/**
 * Run an async factory on mount and whenever `deps` change.
 * Returns data/error/loading plus an imperative refetch().
 *
 * Intentionally does NOT poll — live updates are expected to arrive over SSE.
 * Call refetch() after a mutation to pull fresh state in the meantime.
 */
export function useAsync<T>(
  factory: () => Promise<T>,
  deps: DependencyList,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)
      try {
        const result = await factory()
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
    // `factory` is recreated each render by design; callers pass an explicit
    // deps array describing what the request actually depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, error, loading, refetch }
}
