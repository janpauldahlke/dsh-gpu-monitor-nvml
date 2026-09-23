/**
 * Shared snapshot types: the host half produces these, the client half
 * renders them. Kept dependency-free so both esbuild entries can inline it.
 */

/** Sample source: 'nvml' = full-fidelity NVML, 'smi' = labeled degraded nvidia-smi. */
export type GpuSource = 'nvml' | 'smi' | 'stub'

/** One host sample of the whole GPU fleet. */
export interface GpuFleetSnapshot {
  /** Whether the last sample succeeded (at least partially). */
  ok: boolean
  /** Sample source. */
  source: GpuSource
  /** Wall-clock time of the sample (epoch ms). */
  sampledAt: number
  /** Human-readable error text when ok is false. */
  error?: string
  /** Driver string common to the fleet, e.g. "570.86.15". */
  driverVersion?: string
  /** Per-GPU samples, index-ordered. */
  gpus: GpuSample[]
}

/** One GPU's sample. All metric fields are undefined when the source lacks them. */
export interface GpuSample {
  index: number
  name: string
  uuid?: string
  /** Utilization percent (0-100). */
  utilization?: number
  /** Memory utilization percent (0-100). */
  memoryUtilization?: number
  /** Memory in MiB. NVML source: used = total - free (driver's full view);
   * the smi source's "used" column is a process-based figure that can be lower. */
  memoryUsedMiB?: number
  /** Free memory in MiB. */
  memoryFreeMiB?: number
  memoryTotalMiB?: number
  /** Temperature in Celsius. */
  temperatureC?: number
  /** Power draw in watts. */
  powerW?: number
  /** Power limit in watts. */
  powerLimitW?: number
  /** SM (graphics) clock in MHz. */
  clockMhz?: number
  /** Memory clock in MHz. */
  memClockMhz?: number
  /** Per-GPU sample error (partial-sample marker). */
  error?: string
  /** Compute processes on this GPU. */
  processes: GpuProcess[]
}

/** One compute process on a GPU. */
export interface GpuProcess {
  pid: number
  /** Process name when resolvable (Linux /proc; smi supplies names on Windows). */
  name?: string
  /** GPU memory used by the process in MiB. */
  usedMemoryMiB?: number
}

/** Round helper: NVML reports mW; the pane wants watts with one decimal. */
export function round1(x: number): number {
  return Math.round(x * 10) / 10
}
