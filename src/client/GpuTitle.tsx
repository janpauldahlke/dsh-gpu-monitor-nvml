import type { GpuSample } from '../shared/types.ts'
import { useGpuLive } from './useGpu.ts'

/**
 * Live tab title chip. Health dot (fleet worst threshold level) + compact
 * fleet numbers:
 *   - 1 GPU:   GPU · util% · used/totalG
 *   - 2+ GPUs: GPU · avg util% · Σ used/Σ totalG (per-GPU breakdown in tooltip)
 * Stays live via the shared store even while the pane body is closed, and
 * dims when the last good sample is older than 3 s.
 */

/** MiB → "G" string: 1 decimal, whole numbers ≥ 10 rendered bare. */
export function gbytes(miB: number): string {
  const gb = miB / 1024
  if (!Number.isFinite(gb)) return '—'
  return gb >= 10 ? `${Math.round(gb)}` : gb.toFixed(1)
}

/** One-line per-GPU breakdown for title / dock tooltips. */
export function gpuTooltipLine(g: GpuSample): string {
  return `${g.index}: ${Math.round(g.utilization ?? 0)}% util · ${gbytes(g.memoryUsedMiB ?? 0)}/${gbytes(g.memoryTotalMiB ?? 0)}G · ${g.name}`
}

function Sep() {
  return (
    <span style={{ color: 'color-mix(in srgb, currentColor 35%, transparent)', fontWeight: 400 }}>
      ·
    </span>
  )
}

export function GpuTitle() {
  const { snapshot, now, lastOk, worst } = useGpuLive()
  const gpus = snapshot?.gpus ?? []
  const hasData = gpus.length > 0
  const stale = hasData && lastOk !== null && now - lastOk > 3000

  // Health dot: neutral until there is data, then severity of the worst level.
  let dot = '#8b93a7'
  if (hasData) {
    dot = worst === 'crit' ? '#ef4444' : worst === 'warn' ? '#f59e0b' : '#22c55e'
  }

  let utilPct = 0
  let usedMiB = 0
  let totalMiB = 0
  if (hasData) {
    const sumUtil = gpus.reduce((sum, g) => sum + (g.utilization ?? 0), 0)
    utilPct = gpus.length === 1 ? (gpus[0].utilization ?? 0) : sumUtil / gpus.length
    for (const g of gpus) {
      usedMiB += g.memoryUsedMiB ?? 0
      totalMiB += g.memoryTotalMiB ?? 0
    }
  }

  const title = gpus.length > 1 ? gpus.map(gpuTooltipLine).join('\n') : undefined

  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
        opacity: stale ? 0.5 : 1,
        transition: 'opacity 200ms',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dot,
          display: 'inline-block',
          boxShadow: hasData && !stale ? `0 0 6px ${dot}` : 'none',
        }}
      />
      GPU
      {hasData && (
        <>
          <Sep />
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
            {Math.round(utilPct)}%
          </span>
          <Sep />
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
            {gbytes(usedMiB)}/{gbytes(totalMiB)}G
          </span>
        </>
      )}
    </span>
  )
}
