import { useEffect, useRef, useState } from 'react'

import type { GpuSample } from '../shared/types.ts'

import { gpuLevels, gpuWorst, vramPct, powerFrac, type Level } from './aggregate.ts'
import { useGpuLive } from './useGpu.ts'
import { gbytes } from './GpuTitle.tsx'
import { setPaneOpen } from './paneState.ts'

/** Per-level accent colors shared by the title dot, card borders, and rows. */
const LEVEL_COLOR: Record<Level, string> = {
  ok: 'transparent',
  warn: '#fbbf24',
  crit: '#f87171',
}

/** One per-GPU history point for the 2-minute sparkline window. Percentages 0-100. */
type GpuPoint = {
  /** Time the sample was received (epoch ms). */
  t: number
  /** GPU compute utilization % (0-100). */
  util?: number
  /** VRAM occupancy % of total (0-100). */
  vram?: number
  /** Power draw % of the configured limit (0-100). */
  power?: number
}

const HISTORY_MS = 120_000
const HISTORY_MAX = 120

/** Clamp a 0-100 percentage into the window, or undefined when not a finite number. */
function clampPct(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  return Math.max(0, Math.min(100, v))
}

/** VRAM in GiB with one decimal, or an em dash when the field is missing. */
function gib(mib: number | undefined): string {
  if (mib === undefined || !Number.isFinite(mib)) return '—'
  return `${(mib / 1024).toFixed(1)} GiB`
}

/** Integer percent or em dash. */
function pct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—'
  return `${Math.round(v)} %`
}

/** Whole number (watts, MHz, °C) or em dash. */
function num(v: number | undefined, unit: string): string {
  if (v === undefined || !Number.isFinite(v)) return '—'
  return `${Math.round(v)} ${unit}`
}

/** Signed age in seconds, clamped at zero. */
function age(sampledAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - sampledAt) / 1000))
  return `${s} s ago`
}

function SourceBadge({ source, driver }: { source: 'nvml' | 'smi' | 'stub'; driver?: string }) {
  const styles: Record<string, { bg: string; fg: string; label: string }> = {
    nvml: { bg: 'color-mix(in srgb, currentColor 14%, transparent)', fg: 'currentColor', label: 'NVML' },
    smi: { bg: 'color-mix(in srgb, currentColor 14%, transparent)', fg: 'currentColor', label: 'smi' },
    stub: { bg: 'color-mix(in srgb, currentColor 8%, transparent)', fg: 'currentColor', label: 'no data' },
  }
  const s = styles[source] ?? styles.stub
  const base =
    source === 'nvml'
      ? 'Data source: NVML driver API — full fidelity, per-process VRAM'
      : source === 'smi'
        ? 'Data source: nvidia-smi text fallback — some fields (per-process VRAM, memory utilization) unavailable'
        : 'No GPU data available'
  return (
    <span
      title={driver !== undefined && driver !== '' ? `${base} (driver ${driver})` : base}
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.04em',
        background: s.bg,
        color: s.fg,
      }}
    >
      {s.label}
    </span>
  )
}

/** Muted "·" separator for the fleet meta band. */
function MetaSep() {
  return <span style={{ color: 'color-mix(in srgb, currentColor 35%, transparent)' }}>·</span>
}

/**
 * A thin horizontal meter: a track with a fill up to `frac` (0-1+), used
 * to show how far a value is against its scale (percent of 100, used of
 * total, draw of limit). Carries its own native tooltip with the exact
 * share; the parent row's tooltip still applies to the label and value.
 */
function Meter({ frac, tooltip, tone }: { frac: number | undefined; tooltip: string; tone?: Level | 'na' }) {
  const w = frac === undefined || !Number.isFinite(frac) ? 0 : Math.max(0, Math.min(1, frac)) * 100
  const fill =
    tone === 'crit'
      ? 'color-mix(in srgb, #f87171 85%, currentColor)'
      : tone === 'warn'
        ? 'color-mix(in srgb, #fbbf24 80%, currentColor)'
        : 'color-mix(in srgb, currentColor 60%, transparent)'
  return (
    <div
      title={tooltip}
      style={{
        flex: 1,
        height: 4,
        borderRadius: 2,
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
        overflow: 'hidden',
        cursor: 'default',
      }}
    >
      <div
        style={{
          width: `${w}%`,
          height: '100%',
          borderRadius: 2,
          background: fill,
          transition: 'width 0.6s linear',
        }}
      />
    </div>
  )
}

/**
 * One labeled metric row: name on the left (with a native tooltip), an
 * optional meter in the middle, the precise value on the right, and an
 * optional caption line under the value.
 */
function Row({ label, tooltip, value, caption, meter, tone }: { label: string; tooltip: string; value: string; caption?: string; meter?: { frac: number | undefined; tooltip: string }; tone?: Level | 'na' }) {
  const valueColor = tone === 'crit' ? '#f87171' : tone === 'warn' ? '#fbbf24' : undefined
  return (
    <div
      title={tooltip}
      style={{
        display: 'flex',
        alignItems: meter !== undefined ? 'center' : 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '2.5px 0',
        cursor: 'default',
      }}
    >
      <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, currentColor 55%, transparent)', flexShrink: 0 }}>
        {label}
      </span>
      {meter !== undefined && <Meter frac={meter.frac} tooltip={meter.tooltip} tone={tone} />}
      <span style={{ textAlign: 'right', flexShrink: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: valueColor }}>{value}</span>
        {caption !== undefined && (
          <span
            style={{
              display: 'block',
              fontSize: 10.5,
              color: 'color-mix(in srgb, currentColor 45%, transparent)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {caption}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * Trend strip for one GPU over the last 2 minutes: one polyline per series
 * (GPU util, VRAM occupancy, power draw vs limit), each on a fixed 0-100 %
 * scale so the lines are directly comparable. Gaps where a series was
 * missing become path breaks, not zero values. The SVG is stretched to the
 * card width via a 120x30 viewBox with non-scaling strokes.
 */
function Sparkline({ points, now }: { points: GpuPoint[]; now: number }) {
  const t0 = now - HISTORY_MS
  const visible = points.filter((p) => p.t >= t0)
  const x = (t: number) => ((t - t0) / HISTORY_MS) * 120
  const y = (pct: number) => 29 - (pct / 100) * 28
  const seriesPath = (pick: (p: GpuPoint) => number | undefined): string => {
    const parts: string[] = []
    let penDown = false
    for (const p of visible) {
      const v = pick(p)
      if (v === undefined) {
        penDown = false
        continue
      }
      const cmd = penDown ? 'L' : 'M'
      parts.push(`${cmd}${x(p.t).toFixed(1)} ${y(v).toFixed(1)}`)
      penDown = true
    }
    return parts.join(' ')
  }
  if (visible.length < 2) {
    return (
      <div style={{ fontSize: 10.5, color: 'color-mix(in srgb, currentColor 45%, transparent)', fontStyle: 'italic' }}>
        collecting history — sparklines appear after a few samples
      </div>
    )
  }
  return (
    <div>
      <svg
        width="100%"
        height={30}
        viewBox="0 0 120 30"
        preserveAspectRatio="none"
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        {[25, 50, 75].map((g) => (
          <line
            key={g}
            x1={0}
            x2={120}
            y1={y(g)}
            y2={y(g)}
            stroke="currentColor"
            strokeOpacity={0.08}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={seriesPath((p) => p.power)} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        <path d={seriesPath((p) => p.vram)} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        <path d={seriesPath((p) => p.util)} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: 10, color: 'color-mix(in srgb, currentColor 55%, transparent)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 2, background: 'currentColor', display: 'inline-block' }} />
          util
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 2, background: 'color-mix(in srgb, currentColor 50%, transparent)', display: 'inline-block' }} />
          vram
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 2, borderTop: '2px dotted currentColor', display: 'inline-block' }} />
          power
        </span>
      </div>
    </div>
  )
}

function GpuCard({ gpu, points, now }: { gpu: GpuSample; points: GpuPoint[]; now: number }) {
  /** Collapsed by default: the header carries the key numbers; expand for full rows. Expanded state persists per GPU. */
  const [expanded, setExpandedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`dsh.gpuMonitor.card.${gpu.index}`) === '1'
    } catch {
      return false
    }
  })
  const setExpanded = (next: boolean) => {
    setExpandedState(next)
    try {
      localStorage.setItem(`dsh.gpuMonitor.card.${gpu.index}`, next ? '1' : '0')
    } catch {
      // storage unavailable; in-memory only
    }
  }
  const [hover, setHover] = useState(false)
  const showName = gpu.name !== undefined && gpu.name !== `GPU ${gpu.index}`
  const levels = gpuLevels(gpu)
  const worst = gpuWorst(gpu)
  const vramPctValue = vramPct(gpu)
  const powerFracValue = powerFrac(gpu)
  const cardBorder =
    worst === 'crit'
      ? '1px solid color-mix(in srgb, #f87171 60%, transparent)'
      : worst === 'warn'
        ? '1px solid color-mix(in srgb, #fbbf24 45%, transparent)'
        : '1px solid color-mix(in srgb, currentColor 18%, transparent)'
  /** Threshold accent for the inline header numbers. */
  const toneColor = (lv: Level | 'na'): string | undefined =>
    lv === 'warn'
      ? 'color-mix(in srgb, #fbbf24 75%, currentColor)'
      : lv === 'crit'
        ? 'color-mix(in srgb, #f87171 80%, currentColor)'
        : undefined
  return (
    <div style={{ border: cardBorder, borderRadius: 8, overflow: 'hidden' }}>
      {/* Collapsible header: chevron + slot + name + all key numbers inline */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        title="Click to expand: full metric rows, 2-minute trend, per-process VRAM"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          padding: '8px 10px',
          cursor: 'pointer',
          userSelect: 'none',
          background: hover ? 'color-mix(in srgb, currentColor 6%, transparent)' : 'transparent',
          transition: 'background 120ms',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            fontSize: 10,
            lineHeight: 1,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 150ms',
            color: 'color-mix(in srgb, currentColor 50%, transparent)',
          }}
        >
          ▸
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.05em',
            padding: '1px 6px',
            borderRadius: 4,
            background: 'color-mix(in srgb, currentColor 12%, transparent)',
            whiteSpace: 'nowrap',
          }}
        >
          GPU {gpu.index}
        </span>
        {showName && (
          <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={gpu.name}>
            {gpu.name}
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 11,
            color: 'color-mix(in srgb, currentColor 75%, transparent)',
          }}
        >
          <span title="GPU compute utilization" style={{ whiteSpace: 'nowrap' }}>
            {gpu.utilization !== undefined && Number.isFinite(gpu.utilization) ? `${Math.round(gpu.utilization)}%` : '—'}
          </span>
          <span title="VRAM used / total" style={{ whiteSpace: 'nowrap', ...(toneColor(levels.vram) ? { color: toneColor(levels.vram) } : {}) }}>
            {gpu.memoryUsedMiB !== undefined && gpu.memoryTotalMiB !== undefined ? `${gbytes(gpu.memoryUsedMiB)}/${gbytes(gpu.memoryTotalMiB)}G` : '—'}
          </span>
          <span title="GPU core temperature" style={{ whiteSpace: 'nowrap', ...(toneColor(levels.temp) ? { color: toneColor(levels.temp) } : {}) }}>
            {gpu.temperatureC !== undefined && Number.isFinite(gpu.temperatureC) ? `${Math.round(gpu.temperatureC)}°C` : '—'}
          </span>
          <span title="Power draw" style={{ whiteSpace: 'nowrap', ...(toneColor(levels.power) ? { color: toneColor(levels.power) } : {}) }}>
            {gpu.powerW !== undefined && Number.isFinite(gpu.powerW) ? `${Math.round(gpu.powerW)}W` : '—'}
          </span>
        </span>
      </div>

      {/* Expanded body: full rows + trend + processes (hidden while collapsed) */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px 8px', borderTop: '1px solid color-mix(in srgb, currentColor 12%, transparent)' }}>
          {/* Utilization: compute vs memory bus, as two named rows */}
      <Row
        label="GPU util"
        tooltip="GPU compute utilization — percent of the last sample interval in which at least one kernel was executing on the GPU (NVML utilization.gpu). A value of 0 means idle, not “no data”. The meter shows the share of the 100 % scale."
        value={pct(gpu.utilization)}
        meter={{ frac: gpu.utilization !== undefined ? gpu.utilization / 100 : undefined, tooltip: `GPU util ${pct(gpu.utilization)} of 100 %` }}
      />
      <Row
        label="Mem util"
        tooltip="Memory-bus utilization — percent of the last sample interval in which the memory interface was active transferring data (NVML utilization.memory). This is bandwidth activity, NOT how much VRAM is occupied. The meter shows the share of the 100 % scale."
        value={pct(gpu.memoryUtilization)}
        meter={{ frac: gpu.memoryUtilization !== undefined ? gpu.memoryUtilization / 100 : undefined, tooltip: `Mem util ${pct(gpu.memoryUtilization)} of 100 %` }}
      />

      {/* VRAM: used / total, with free spelled out */}
      <Row
        label="VRAM"
        tooltip="Video RAM. Used = total − free as reported by the driver (NVML), so it includes ~0.4 GiB of driver/context reservation and reads higher than nvidia-smi's per-process column. Free is the driver's own number, not total minus process usage."
        value={`${gib(gpu.memoryUsedMiB)} / ${gib(gpu.memoryTotalMiB)}`}
        caption={gpu.memoryFreeMiB !== undefined ? `${gib(gpu.memoryFreeMiB)} free` : undefined}
        meter={{
          frac: vramPctValue !== undefined ? vramPctValue / 100 : undefined,
          tooltip: `VRAM ${pct(vramPctValue)} of total`,
        }}
        tone={levels.vram}
      />

      {/* Thermal + power */}
      <Row
        label="Temp"
        tooltip="GPU core temperature — hottest on-die sensor reported by the driver (NVML temperature, sensor 0)."
        value={num(gpu.temperatureC, '°C')}
        tone={levels.temp}
      />
      <Row
        label="Power draw"
        tooltip="Instantaneous power draw across all GPU rails (NVML total power). The caption is the currently configured power limit, not a measured maximum."
        value={gpu.powerW !== undefined ? `${gpu.powerW.toFixed(1)} W` : '—'}
        caption={gpu.powerLimitW !== undefined ? `limit ${gpu.powerLimitW.toFixed(0)} W` : undefined}
        meter={{
          frac: powerFracValue,
          tooltip: `Power ${gpu.powerW !== undefined ? gpu.powerW.toFixed(1) : '—'} W of the ${gpu.powerLimitW !== undefined ? `${gpu.powerLimitW.toFixed(0)} W` : '—'} limit`,
        }}
        tone={levels.power}
      />

      {/* Clocks: SM vs memory, as two named rows */}
      <Row
        label="SM clock"
        tooltip="Graphics/SM (shader) clock — the speed at which the compute cores are currently running (NVML graphics clock). It drops automatically under power or thermal pressure."
        value={num(gpu.clockMhz, 'MHz')}
      />
      <Row
        label="Mem clock"
        tooltip="Memory (GDDR) clock rate — the speed of the VRAM interface (NVML memory clock). Distinct from SM clock and from mem utilization."
        value={num(gpu.memClockMhz, 'MHz')}
      />

      {/* Trend: 2-minute sparklines (util, vram occupancy, power vs limit) */}
      <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid color-mix(in srgb, currentColor 12%, transparent)' }}>
        <div
          title="Rolling trend over the last 2 minutes (one point per second). All three series share a fixed 0-100 % scale so they are directly comparable: GPU compute utilization, VRAM occupancy, and power draw as a share of the configured limit. Gaps mean the metric was unavailable for that second."
          style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'color-mix(in srgb, currentColor 45%, transparent)', marginBottom: 4, cursor: 'default' }}
        >
          Trend · last 2 min
        </div>
        <Sparkline points={points} now={now} />
      </div>

      {/* Processes: per-process VRAM */}
      {gpu.processes.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid color-mix(in srgb, currentColor 12%, transparent)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'color-mix(in srgb, currentColor 45%, transparent)', marginBottom: 2 }}>
            Processes · VRAM
          </div>
          {gpu.processes.map((p) => (
            <div
              key={p.pid}
              title={`Process ${p.name ?? 'unknown'} (pid ${p.pid}) is using ${gib(p.usedMemoryMiB)} of this GPU's VRAM`}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                padding: '1px 0',
                fontSize: 11.5,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600 }}>{p.name ?? `pid ${p.pid}`}</span>
                <span style={{ color: 'color-mix(in srgb, currentColor 45%, transparent)', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {p.name ? `pid ${p.pid}` : ''}
                </span>
              </span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{gib(p.usedMemoryMiB)}</span>
            </div>
          ))}
        </div>
      )}

      {gpu.error && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'color-mix(in srgb, currentColor 70%, transparent)', fontStyle: 'italic' }}>
          {gpu.error}
        </div>
      )}
        </div>
      )}
    </div>
  )
}

export function GpuBody() {
  const live = useGpuLive()
  const snap = live.snapshot
  const now = live.now
  /** Per-GPU rolling history (keyed by index) feeding the 2-minute sparklines. */
  const historyRef = useRef<Map<number, GpuPoint[]>>(new Map())

  useEffect(() => {
    if (!live.snapshot) return
    const t = Date.now()
    const history = historyRef.current
    for (const g of live.snapshot.gpus) {
      const pts = history.get(g.index) ?? []
      pts.push({
        t,
        util: clampPct(g.utilization),
        vram: g.memoryUsedMiB !== undefined && g.memoryTotalMiB !== undefined && g.memoryTotalMiB > 0 ? clampPct((g.memoryUsedMiB / g.memoryTotalMiB) * 100) : undefined,
        power: g.powerW !== undefined && g.powerLimitW !== undefined && g.powerLimitW > 0 ? clampPct((g.powerW / g.powerLimitW) * 100) : undefined,
      })
      const cutoff = t - HISTORY_MS
      let drop = 0
      while (drop < pts.length && pts[drop].t < cutoff) drop++
      if (drop > 0) pts.splice(0, drop)
      if (pts.length > HISTORY_MAX) pts.splice(0, pts.length - HISTORY_MAX)
      history.set(g.index, pts)
    }
  }, [live.snapshot])

  // Report the pane open/closed to the shared pane state so the composer
  // dock chip can hide itself while this body is mounted.
  useEffect(() => {
    setPaneOpen(true)
    return () => setPaneOpen(false)
  }, [])

  const stale = snap !== null && live.lastOk !== null && now - live.lastOk > 3000

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, userSelect: 'text' }}>
      {/* Fleet meta band — one quiet line under the tab chrome: source badge
          (driver version lives in its tooltip), GPU count, sample age, and
          stale/poll-error flags when present. No in-pane heading: the tab
          chip already says "GPU Monitor". Horizontal padding matches GpuCard
          so the band text and card content share a left edge. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 8,
          padding: '8px 10px',
          borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
          fontSize: 11,
          color: 'color-mix(in srgb, currentColor 55%, transparent)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {snap ? (
          <>
            <SourceBadge source={snap.source} driver={snap.driverVersion} />
            <MetaSep />
            <span>
              {snap.gpus.length} GPU{snap.gpus.length === 1 ? '' : 's'}
            </span>
            <MetaSep />
            <span
              title={
                live.error
                  ? 'Age of the last successful sample — the poll is currently failing'
                  : 'Age of the last successful sample'
              }
            >
              {live.lastOk !== null ? `last updated ${age(live.lastOk, now)}` : '…'}
            </span>
            {stale && (
              <>
                <MetaSep />
                <span
                  title="No successful sample in the last 3 s — showing the last one, which may be stale"
                  style={{ fontStyle: 'italic' }}
                >
                  stale (&gt; 3 s)
                </span>
              </>
            )}
            {live.error && (
              <>
                <MetaSep />
                <span
                  title={live.error}
                  style={{ fontStyle: 'italic', color: 'color-mix(in srgb, currentColor 70%, transparent)' }}
                >
                  poll error: {live.error}
                </span>
              </>
            )}
          </>
        ) : (
          <span>waiting for first sample…</span>
        )}
        {!snap && live.error && (
          <>
            <MetaSep />
            <span
              title={live.error}
              style={{ fontStyle: 'italic', color: 'color-mix(in srgb, currentColor 70%, transparent)' }}
            >
              poll error: {live.error}
            </span>
          </>
        )}
      </div>

      {/* GPU cards */}
      {snap &&
        snap.ok === false &&
        snap.error && (
          <div style={{ fontSize: 11.5, padding: '8px 10px', border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', borderRadius: 6, fontStyle: 'italic' }}>
            {snap.error}
          </div>
        )}
      {snap &&
        snap.gpus.map((gpu) => (
          <GpuCard key={gpu.uuid ?? gpu.index} gpu={gpu} points={historyRef.current.get(gpu.index) ?? []} now={now} />
        ))}
      {snap === null && (
        <div style={{ fontSize: 11.5, color: 'color-mix(in srgb, currentColor 55%, transparent)', fontStyle: 'italic' }}>
          Sampling GPUs at 1 Hz — first sample arrives within a second.
        </div>
      )}
    </div>
  )
}
