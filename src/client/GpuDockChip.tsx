import { useEffect, useState } from 'react'

import { useGpuLive } from './useGpu.ts'
import { gbytes, gpuTooltipLine } from './GpuTitle.tsx'
import { isPaneOpen, subscribePaneOpen } from './paneState.ts'

/**
 * Compact fleet chip docked in the conversation composer footer
 * (slot `conversation.composer.dock`, alongside StatsPills). It shows the
 * live GPU fleet while the rightbar pane is closed and hides itself while
 * the pane is open, so the two surfaces never duplicate — each reads the
 * shared pane state and manages its own visibility.
 *
 * Renders: health dot (fleet worst level) · GPU · peak util% · Σ used/Σ total
 * VRAM. Clicking it opens (and focuses) the GPU Monitor pane. Dims when the
 * last good sample is older than 3 s.
 */
export function GpuDockChip({ onOpen }: { onOpen: () => void }) {
  const { snapshot, now, lastOk, worst, peakUtil } = useGpuLive()
  const [paneOpen, setPaneOpenState] = useState(isPaneOpen)
  useEffect(() => subscribePaneOpen(() => setPaneOpenState(isPaneOpen())), [])

  if (paneOpen) return null

  const gpus = snapshot?.gpus ?? []
  const hasData = gpus.length > 0
  const stale = hasData && lastOk !== null && now - lastOk > 3000

  let dot = '#8b93a7'
  if (hasData) {
    dot = worst === 'crit' ? '#ef4444' : worst === 'warn' ? '#f59e0b' : '#22c55e'
  }

  let usedMiB = 0
  let totalMiB = 0
  let title = 'GPU monitoring — waiting for first sample'
  if (hasData) {
    for (const g of gpus) {
      usedMiB += g.memoryUsedMiB ?? 0
      totalMiB += g.memoryTotalMiB ?? 0
    }
    const lines = gpus.map(gpuTooltipLine)
    if (stale && lastOk !== null) {
      lines.push('', `stale — last updated ${Math.max(1, Math.round((now - lastOk) / 1000))} s ago`)
    }
    title = lines.join('\n')
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label="Open GPU monitor pane"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
        padding: '1px 8px',
        borderRadius: 999,
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        background: 'color-mix(in srgb, currentColor 6%, transparent)',
        color: 'inherit',
        cursor: 'pointer',
        opacity: stale ? 0.55 : 1,
        transition: 'opacity 200ms',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: dot,
          display: 'inline-block',
          boxShadow: hasData && !stale ? `0 0 5px ${dot}` : 'none',
        }}
      />
      GPU
      {hasData && (
        <>
          <span style={{ color: 'color-mix(in srgb, currentColor 35%, transparent)', fontWeight: 400 }}>·</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(peakUtil)}% · {gbytes(usedMiB)}/{gbytes(totalMiB)}G
          </span>
        </>
      )}
    </button>
  )
}
