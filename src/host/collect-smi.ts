/**
 * Labeled degraded fallback: samples via `nvidia-smi` CSV output when the
 * NVML binding is unavailable (import failure, platform without libnvidia-ml,
 * driver mismatch). The snapshot is marked source: 'smi' so the pane can
 * label the pane state honestly. Per-tick spawn (1 Hz is cheap for nvidia-smi).
 *
 * Windows: Driver install usually puts `nvidia-smi.exe` on PATH; older layouts
 * keep it under Program Files\NVIDIA Corporation\NVSMI. We try a short
 * candidate list once and cache the winner for the rest of the process.
 */
import { execFile } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GpuFleetSnapshot, GpuProcess, GpuSample } from '../shared/types.ts'
import { round1 } from '../shared/types.ts'

const pExecFile = promisify(execFile)

const GPU_FIELDS = [
  'index', 'name', 'uuid', 'driver_version',
  'utilization.gpu', 'utilization.memory',
  'memory.used', 'memory.free', 'memory.total',
  'temperature', 'power.draw', 'power.limit',
  'clocks.sm', 'clocks.mem',
].join(',')

const APP_FIELDS = 'pid,process_name,used_memory,gpu_uuid'

/** Cached path/command that successfully ran nvidia-smi for this process. */
let resolvedSmi: string | undefined

function winSmiCandidates(): string[] {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const root = process.env['SystemRoot'] ?? 'C:\\Windows'
  return [
    'nvidia-smi.exe',
    'nvidia-smi',
    join(root, 'System32', 'nvidia-smi.exe'),
    join(pf, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    join(pf86, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
  ]
}

function smiCandidates(): string[] {
  if (process.platform === 'win32') return winSmiCandidates()
  return ['nvidia-smi']
}

function isAbsoluteCandidate(bin: string): boolean {
  return bin.includes('/') || bin.includes('\\')
}

/** Prefer absolute paths that exist; PATH names are tried via execFile. */
function orderedCandidates(): string[] {
  const out: string[] = []
  for (const bin of smiCandidates()) {
    if (isAbsoluteCandidate(bin)) {
      try {
        accessSync(bin, fsConstants.X_OK)
        out.push(bin)
      } catch {
        try {
          accessSync(bin, fsConstants.F_OK)
          out.push(bin)
        } catch { /* missing */ }
      }
    } else {
      out.push(bin)
    }
  }
  return out
}

async function execSmi(args: string[]): Promise<string | undefined> {
  const bins = resolvedSmi !== undefined ? [resolvedSmi] : orderedCandidates()
  for (const bin of bins) {
    try {
      const { stdout } = await pExecFile(bin, args, {
        timeout: 5000,
        windowsHide: true,
      })
      resolvedSmi = bin
      return stdout
    } catch {
      /* try next */
    }
  }
  return undefined
}

function parseCsv(text: string): string[][] {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split(',').map(cell => cell.trim()))
}

function toNumber(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined
  const n = Number(cell)
  return Number.isFinite(n) ? n : undefined
}

/** One degraded fleet sample. Never throws. */
export async function sampleSmi(): Promise<GpuFleetSnapshot> {
  const at = Date.now()
  try {
    const [gpuOut, appOut] = await Promise.all([
      execSmi([
        '--query-gpu=' + GPU_FIELDS,
        '--format=csv,noheader,nounits',
      ]),
      execSmi([
        '--query-compute-apps=' + APP_FIELDS,
        '--format=csv,noheader,nounits',
      ]),
    ])
    if (gpuOut === undefined || gpuOut.trim() === '') {
      return {
        ok: false,
        source: 'smi',
        sampledAt: at,
        error: 'nvidia-smi unavailable or returned no GPUs',
        gpus: [],
      }
    }

    const rows = parseCsv(gpuOut)
    const gpus: GpuSample[] = []
    for (const row of rows) {
      const get = (field: string): string | undefined => {
        const idx = GPU_FIELDS.split(',').indexOf(field)
        return idx >= 0 ? row[idx] : undefined
      }
      const sample: GpuSample = {
        index: toNumber(get('index')) ?? gpus.length,
        name: get('name') ?? 'GPU',
        processes: [],
      }
      const uuid = get('uuid')
      if (uuid && uuid !== '[N/A]') sample.uuid = uuid
      sample.utilization = toNumber(get('utilization.gpu'))
      sample.memoryUtilization = toNumber(get('utilization.memory'))
      sample.memoryUsedMiB = toNumber(get('memory.used'))
      sample.memoryFreeMiB = toNumber(get('memory.free'))
      sample.memoryTotalMiB = toNumber(get('memory.total'))
      sample.temperatureC = toNumber(get('temperature'))
      sample.powerW = toNumber(get('power.draw')) === undefined ? undefined
        : round1(Number(get('power.draw')))
      sample.powerLimitW = toNumber(get('power.limit')) === undefined ? undefined
        : round1(Number(get('power.limit')))
      sample.clockMhz = toNumber(get('clocks.sm'))
      sample.memClockMhz = toNumber(get('clocks.mem'))
      gpus.push(sample)
    }

    // Per-GPU process attribution via gpu_uuid (matches the GPU row uuids).
    if (appOut && appOut.trim() !== '') {
      const byGpu = new Map<string, GpuProcess[]>()
      const unattributed: GpuProcess[] = []
      for (const row of parseCsv(appOut)) {
        const pid = toNumber(row[0])
        if (pid === undefined) continue
        const name = row[1] && row[1] !== '[N/A]' ? row[1] : undefined
        const used = toNumber(row[2])
        const uuid = row[3] && row[3] !== '[N/A]' ? row[3] : undefined
        const proc: GpuProcess = {
          pid,
          ...(name ? { name } : {}),
          ...(used !== undefined ? { usedMemoryMiB: round1(used) } : {}),
        }
        if (uuid === undefined) {
          unattributed.push(proc)
          continue
        }
        const list = byGpu.get(uuid)
        if (list) list.push(proc)
        else byGpu.set(uuid, [proc])
      }
      for (const gpu of gpus) {
        if (gpu.uuid !== undefined) gpu.processes = byGpu.get(gpu.uuid) ?? []
      }
      if (unattributed.length > 0 && gpus.length === 1) gpus[0].processes.push(...unattributed)
    }

    return {
      ok: true,
      source: 'smi',
      sampledAt: at,
      driverVersion: gpus.length > 0 ? rows[0][3] && rows[0][3] !== '[N/A]' ? rows[0][3] : undefined : undefined,
      gpus,
    }
  } catch (error) {
    return {
      ok: false,
      source: 'smi',
      sampledAt: at,
      error: error instanceof Error ? error.message : String(error),
      gpus: [],
    }
  }
}
