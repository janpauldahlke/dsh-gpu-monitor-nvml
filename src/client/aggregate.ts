/**
 * Pure selectors and the shared threshold model for the GPU monitor. Both the
 * tab title (GpuTitle.tsx) and the pane body (GpuBody.tsx) import from here so
 * the warn/crit cutoffs and the "worst in the fleet" logic are defined exactly
 * once. Nothing in this module touches React or the network.
 */
import type { GpuFleetSnapshot, GpuSample } from '../shared/types.ts'

export type Level = 'ok' | 'warn' | 'crit'

// Thresholds (absolute values unless noted). VRAM and temperature are absolute
// (a percentage of capacity, and degrees, respectively); power is a fraction of
// the card's own configured limit.
export const VRAM_WARN = 90
export const VRAM_CRIT = 97
export const TEMP_WARN = 80
export const TEMP_CRIT = 88
export const POWER_WARN_FRAC = 0.9
export const POWER_CRIT_FRAC = 1.0

/** VRAM occupancy as a percentage of total (0-100), or undefined when unavailable. */
export function vramPct(gpu: GpuSample): number | undefined {
  if (gpu.memoryUsedMiB == null || gpu.memoryTotalMiB == null || gpu.memoryTotalMiB <= 0) return undefined
  return (gpu.memoryUsedMiB / gpu.memoryTotalMiB) * 100
}

/** Power draw as a fraction of the configured limit, or undefined when unavailable. */
export function powerFrac(gpu: GpuSample): number | undefined {
  if (gpu.powerW == null || gpu.powerLimitW == null || gpu.powerLimitW <= 0) return undefined
  return gpu.powerW / gpu.powerLimitW
}

/** Level for a metric measured in the same unit as the warn/crit cutoffs. */
export function levelFor(value: number | undefined, warn: number, crit: number): Level | 'na' {
  if (value == null) return 'na'
  if (value >= crit) return 'crit'
  if (value >= warn) return 'warn'
  return 'ok'
}

/** Per-card levels for the three thresholded metrics ('na' when not sampled). */
export function gpuLevels(gpu: GpuSample): { vram: Level | 'na'; temp: Level | 'na'; power: Level | 'na' } {
  return {
    vram: levelFor(vramPct(gpu), VRAM_WARN, VRAM_CRIT),
    temp: levelFor(gpu.temperatureC, TEMP_WARN, TEMP_CRIT),
    power: levelFor(powerFrac(gpu), POWER_WARN_FRAC, POWER_CRIT_FRAC),
  }
}

const RANK: Record<Level, number> = { ok: 0, warn: 1, crit: 2 }

/** The more severe of two levels. */
export function worstLevel(a: Level, b: Level): Level {
  return RANK[a] >= RANK[b] ? a : b
}

/** Worst level across a single card's thresholded metrics. */
export function gpuWorst(gpu: GpuSample): Level {
  const l = gpuLevels(gpu)
  const vram = l.vram === 'na' ? 'ok' : l.vram
  const temp = l.temp === 'na' ? 'ok' : l.temp
  const power = l.power === 'na' ? 'ok' : l.power
  return worstLevel(worstLevel(vram, temp), power)
}

/** Worst level anywhere in the fleet ('ok' when there is no data). */
export function fleetWorst(snap: GpuFleetSnapshot | null): Level {
  if (!snap) return 'ok'
  return snap.gpus.reduce<Level>((worst, g) => worstLevel(worst, gpuWorst(g)), 'ok')
}

/** Peak compute utilization across the fleet (0 when idle / no data). */
export function fleetPeakUtil(snap: GpuFleetSnapshot | null): number {
  if (!snap) return 0
  return snap.gpus.reduce((m, g) => Math.max(m, g.utilization ?? 0), 0)
}

/** Peak power draw across the fleet (0 when idle / no data). */
export function fleetPeakPower(snap: GpuFleetSnapshot | null): number {
  if (!snap) return 0
  return snap.gpus.reduce((m, g) => Math.max(m, g.powerW ?? 0), 0)
}

/** Peak VRAM occupancy across the fleet (0 when idle / no data). */
export function fleetPeakVram(snap: GpuFleetSnapshot | null): number {
  if (!snap) return 0
  return snap.gpus.reduce((m, g) => Math.max(m, vramPct(g) ?? 0), 0)
}
