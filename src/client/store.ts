/**
 * Client-side live-GPU store: the single source of truth for GPU data in the
 * browser. One module-level poller fetches the host endpoint at 1 Hz and fans
 * out to every subscriber (the pane body and the tab title).
 *
 * Why module-level rather than per-component:
 *   - the tab title is mounted all the time, the pane body only while its tab
 *     is open. A shared store keeps the title live even when the pane is
 *     closed, and guarantees exactly one in-flight poll regardless of how
 *     many components are subscribed.
 *   - the store stops itself when the last subscriber leaves, so an unmounted
 *     pane never leaks a 1 Hz poller.
 *
 * No React is imported here: the store is pure and the thin React hook lives
 * in useGpu.ts.
 */
import type { GpuFleetSnapshot } from '../shared/types.ts'

const API_PATH = '/api/dsh-gpu-monitor'
const POLL_MS = 1000

type Listener = () => void

let snapshot: GpuFleetSnapshot | null = null
let error: string | null = null
let lastOk: number | null = null
let lastAttempt: number | null = null
let listeners = new Set<Listener>()
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false

function emit(): void {
  for (const l of [...listeners]) l()
}

/** Start the poll loop if it is not already running. Idempotent. */
function start(): void {
  if (timer !== null || inFlight) return
  void tick()
}

/** Stop the loop once nobody is listening (an in-flight fetch still finishes). */
function stopIfIdle(): void {
  if (listeners.size > 0) return
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

async function tick(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const res = await fetch(API_PATH, { cache: 'no-store' })
    if (!res.ok) throw new Error(`poll failed: HTTP ${res.status}`)
    const data = (await res.json()) as GpuFleetSnapshot
    snapshot = data
    error = null
    lastOk = Date.now()
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  } finally {
    lastAttempt = Date.now()
    inFlight = false
    emit()
    if (listeners.size > 0) {
      if (timer === null) timer = setTimeout(() => {
        timer = null
        void tick()
      }, POLL_MS)
    }
  }
}

/** Subscribe to poll updates. Returns the unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
    stopIfIdle()
  }
}

export function getSnapshot(): GpuFleetSnapshot | null {
  return snapshot
}

export function getPollError(): string | null {
  return error
}

/** Wall-clock time of the most recent successful sample (epoch ms). */
export function getLastOk(): number | null {
  return lastOk
}

/** Wall-clock time of the most recent poll attempt, success or failure (epoch ms). */
export function getLastAttempt(): number | null {
  return lastAttempt
}
