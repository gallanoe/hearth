import { useEffect, useLayoutEffect, useRef } from "react"

/** How close to the bottom (px) still counts as "at the bottom". */
const THRESHOLD = 80

/** Nearest scrollable ancestor of `el`, or null if none. */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === "auto" || overflowY === "scroll") return node
    node = node.parentElement
  }
  return null
}

/**
 * Keep a scroll container pinned to the bottom as content grows — but only while
 * the user is already at (or near) the bottom. If they've scrolled up to read
 * back, new content won't yank them down.
 *
 * Place the returned ref on an empty element at the very end of the scrollable
 * content; its nearest scrollable ancestor is treated as the container.
 *
 * @param contentKey changes whenever content is appended/updated (e.g. a message
 *   count + last-message signature), triggering the stick-to-bottom check.
 * @param resetKey changes when the view is replaced wholesale (e.g. a different
 *   session); on change it jumps straight to the bottom regardless of position.
 */
export function useStickToBottom(contentKey: unknown, resetKey?: unknown) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const atBottomRef = useRef(true)

  // Track whether the viewport is parked at the bottom.
  useEffect(() => {
    const container =
      containerRef.current ??
      (anchorRef.current ? findScrollParent(anchorRef.current) : null)
    if (!container) return
    containerRef.current = container

    const onScroll = () => {
      atBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        THRESHOLD
    }
    onScroll()
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [])

  // A fresh view (new session): always land at the bottom.
  useLayoutEffect(() => {
    if (!containerRef.current && anchorRef.current)
      containerRef.current = findScrollParent(anchorRef.current)
    atBottomRef.current = true
    const c = containerRef.current
    if (c) c.scrollTop = c.scrollHeight
  }, [resetKey])

  // New content: stick to the bottom only if the user is already there.
  useLayoutEffect(() => {
    if (!atBottomRef.current) return
    if (!containerRef.current && anchorRef.current)
      containerRef.current = findScrollParent(anchorRef.current)
    const c = containerRef.current
    if (c) c.scrollTop = c.scrollHeight
  }, [contentKey])

  return anchorRef
}
