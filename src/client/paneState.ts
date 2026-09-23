/**
 * Shared pane-open state for the GPU monitor surfaces. The dock chip and the
 * rightbar tab are registered once and coexist; each decides its own
 * visibility from this flag instead of swapping slots.
 *
 * `GpuBody` reports its mount/unmount here (mount == the rightbar tab holding
 * the GPU pane is open). The dock chip hides itself while the open count is
 * greater than zero — reference-counted so a second open pane (e.g. a second
 * Session with the GPU tab) does not reappear when one of them closes.
 * Module-level like the live store: no React dependency, works at 1 Hz.
 */

type Listener = () => void

/** Number of mounted GPU pane bodies. */
let openCount = 0
const listeners = new Set<Listener>()

/** Report a body mount (`true`) or unmount (`false`), notifying on change. */
export function setPaneOpen(open: boolean): void {
  const next = open ? openCount + 1 : Math.max(0, openCount - 1)
  if (next === openCount) return
  openCount = next
  for (const listener of [...listeners]) listener()
}

/** True while any GPU pane body is mounted (a rightbar tab is open). */
export function isPaneOpen(): boolean {
  return openCount > 0
}

/** Subscribe to pane-open changes. Returns the unsubscribe function. */
export function subscribePaneOpen(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
