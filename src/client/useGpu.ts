/**
 * Thin React binding over the shared live-GPU store. Re-renders a component
 * once per poll (success or failure) by replacing the snapshot object.
 * Works on any React version (no useSyncExternalStore dependency).
 */
import { useEffect, useState } from 'react'
import type { GpuFleetSnapshot } from '../shared/types.ts'
import { getSnapshot, getPollError, getLastOk, getLastAttempt, subscribe } from './store.ts'
import { fleetPeakUtil, fleetPeakPower, fleetPeakVram, fleetWorst } from './aggregate.ts'

export interface GpuLive {
  snapshot: GpuFleetSnapshot | null
  /** Set when the most recent poll attempt failed (null when the last one succeeded). */
  error: string | null
  /** Wall-clock of the most recent successful sample (epoch ms), or null. */
  lastOk: number | null
  /** Wall-clock of the most recent poll attempt, success or failure (epoch ms). */
  now: number
  /** Peak compute utilization across the fleet (0 when idle / no data). */
  peakUtil: number
  /** Peak memory usage across the fleet (0 when idle / no data). */
  peakVram: number
  /** Peak power draw across the fleet (0 when idle / no data). */
  peakPower: number
  /** Most severe threshold level anywhere in the fleet. */
  worst: 'ok' | 'warn' | 'crit'
}

function readLive(): GpuLive {
  const snapshot = getSnapshot()
  return {
    snapshot,
    error: getPollError(),
    lastOk: getLastOk(),
    now: getLastAttempt() ?? Date.now(),
    peakUtil: fleetPeakUtil(snapshot),
    peakVram: fleetPeakVram(snapshot),
    peakPower: fleetPeakPower(snapshot),
    worst: fleetWorst(snapshot),
  }
}

export function useGpuLive(): GpuLive {
  const [live, setLive] = useState<GpuLive>(readLive)
  useEffect(() => {
    const unsubscribe = subscribe(() => setLive(readLive()))
    return unsubscribe
  }, [])
  return live
}
