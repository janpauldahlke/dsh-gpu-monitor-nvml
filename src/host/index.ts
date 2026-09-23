/**
 * Host half of dsh-gpu-monitor-nvml.
 *
 * Registers the /api/dsh-gpu-monitor route on the harness webserver and runs
 * a 1 Hz sampler behind it. Boot-safe by design: GPU errors are runtime
 * states served by the route, never boot-time throws.
 *
 * Source selection: NVML (full fidelity) is tried first; if the binding
 * cannot load at all for this boot, sampling degrades permanently to the
 * labeled `smi` fallback for the remainder of this boot.
 * On Windows, node-nvml currently ships Linux-only binaries, so boot
 * typically lands on the hardened nvidia-smi path (honest `smi` badge).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { GpuFleetSnapshot } from '../shared/types.ts'
import { loadNvml, sampleNvml } from './collect.ts'
import { sampleSmi } from './collect-smi.ts'

export const name = 'dsh-gpu-monitor-nvml'
export const inject = ['webServer']

export { ROUTE } from './route.ts'
import { ROUTE } from './route.ts'
export type { GpuFleetSnapshot, GpuSample, GpuProcess, GpuSource } from '../shared/types.ts'

/** Interval between samples (ms). The pane polls at ~1 Hz. */
export const SAMPLE_INTERVAL_MS = 1000

/** The most recent sample; refreshed in place by the sampler. */
let latest: GpuFleetSnapshot = { ok: true, source: 'stub', sampledAt: Date.now(), gpus: [] }
let nvmlReady: boolean | undefined
let inFlight = false
let timer: ReturnType<typeof setInterval> | undefined

/** One sampling pass; never throws, never runs twice concurrently. */
async function tick(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    if (nvmlReady === undefined) {
      try {
        await loadNvml()
        nvmlReady = true
      } catch {
        nvmlReady = false
      }
    }
    latest = nvmlReady ? await sampleNvml() : await sampleSmi()
  } catch {
    // Unreachable by contract; keep the last snapshot on any surprise.
  } finally {
    inFlight = false
  }
}

export function apply(ctx: Context): void {
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain' })
        res.end('method not allowed')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(latest))
    },
  })
  // The effect body runs immediately and must RETURN the disposer.
  ctx.effect(() => {
    void tick()
    timer = setInterval(() => { void tick() }, SAMPLE_INTERVAL_MS)
    timer.unref?.()
    return () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
  }, 'gpu-monitor: sampler')
  ctx.effect(() => unregister, 'gpu-monitor: /api/dsh-gpu-monitor route')
}
