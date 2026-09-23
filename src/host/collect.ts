/**
 * NVML sampling: full-fidelity GPU metrics via node-nvml (prebuilt N-API
 * binding, zero dependencies). The binding's "convenient" js proxy mangles
 * zero-argument output-pointer calls, so this drives the raw C.functions
 * interface with hand-allocated buffers.
 *
 * Boot-safety contract: `sampleFleet()` never throws. Every NVML failure
 * becomes an ok:false (or partial) snapshot with a human-readable error.
 */
import { readFileSync } from 'node:fs'
import type { GpuFleetSnapshot, GpuProcess, GpuSample } from '../shared/types.ts'
import { round1 } from '../shared/types.ts'

/** NVML return codes we bother naming; everything else falls back to the lib text. */
const NVML_ERRORS: Record<number, string> = {
  2: 'no NVIDIA devices found',
  3: 'driver not loaded',
  13: 'invalid argument',
  22: 'driver not ready',
  23: 'function not found (binding/driver mismatch)',
}

const NVML_SUCCESS = 0

/** The shape of the loaded binding (subset actually used). */
interface NvmlBinding {
  C: {
    functions: Record<string, (...args: unknown[]) => number>
    sizes: Record<string, number>
  }
  allocT: (type: string) => Buffer & { decode: (...a: unknown[]) => unknown }
}

let binding: NvmlBinding | undefined

/**
 * Load (once) and return the initialized binding. Throws only when the module
 * itself cannot be imported/initialized (missing binding file, NVML init
 * failure) — the caller decides how to label that state.
 */
export async function loadNvml(): Promise<NvmlBinding> {
  if (binding !== undefined) return binding
  const mod = (await import('node-nvml')) as Record<string, any>
  const inst = mod.default?.default ?? mod.default
  if (!inst?.C?.functions) throw new Error('node-nvml binding has no C functions')
  binding = inst
  return inst
}

function errText(nvml: NvmlBinding, ret: number): string {
  const named = NVML_ERRORS[ret]
  if (named) return `NVML error ${ret}: ${named}`
  try {
    const buf = Buffer.alloc(80)
    const r = nvml.C.functions.nvmlErrorString(ret, buf)
    if (r === NVML_SUCCESS) {
      const text = buf.toString('utf8', 0, buf.indexOf(0)).trim()
      if (text) return `NVML error ${ret}: ${text}`
    }
  } catch { /* keep the generic text */ }
  return `NVML error ${ret}`
}

/** Allocate a struct buffer of the given NVML type name. */
function struct(nvml: NvmlBinding, type: string): Buffer {
  const size = nvml.C.sizes[type]
  if (!size) throw new Error(`unknown NVML struct ${type}`)
  return Buffer.alloc(size)
}

/** A 64-bit handle cell: write/read a GPU handle as a u64. */
function cell(): Buffer {
  const buf = Buffer.alloc(8)
  return buf
}

function readCString(buf: Buffer): string {
  const end = buf.indexOf(0)
  return buf.toString('utf8', 0, end === -1 ? buf.length : end)
}

/** Best-effort process name from /proc (Linux only); undefined elsewhere. */
function procName(pid: number): string | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    const raw = readFileSync(`/proc/${pid}/comm`, 'utf8')
    return raw.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Sample one GPU. `nvml` is the live binding, `index` the device index.
 * Returns the sample plus a per-field error note when a call failed.
 */
function sampleDevice(nvml: NvmlBinding, index: number): GpuSample {
  const f = nvml.C.functions
  const handle = cell()
  const ret = f.nvmlDeviceGetHandleByIndex_v2(index, handle)
  if (ret !== NVML_SUCCESS) {
    return { index, name: `GPU ${index}`, processes: [], error: errText(nvml, ret) }
  }
  const sample: GpuSample = { index, name: `GPU ${index}`, processes: [] }
  const errors: string[] = []

  const nameBuf = Buffer.alloc(256)
  if (f.nvmlDeviceGetName(handle, nameBuf, 256) === NVML_SUCCESS) {
    sample.name = readCString(nameBuf)
  }
  const uuidBuf = Buffer.alloc(96)
  if (f.nvmlDeviceGetUUID(handle, uuidBuf, 96) === NVML_SUCCESS) {
    sample.uuid = readCString(uuidBuf) || undefined
  }

  const util = struct(nvml, 'struct_nvmlUtilization_st')
  if (f.nvmlDeviceGetUtilizationRates(handle, util) === NVML_SUCCESS) {
    sample.utilization = util.readUInt32LE(0)
    sample.memoryUtilization = util.readUInt32LE(4)
  } else {
    errors.push('utilization')
  }

  const mem = struct(nvml, 'struct_nvmlMemory_st')
  if (f.nvmlDeviceGetMemoryInfo(handle, mem) === NVML_SUCCESS) {
    sample.memoryTotalMiB = Number(mem.readBigUInt64LE(0)) / 1048576
    sample.memoryFreeMiB = Number(mem.readBigUInt64LE(8)) / 1048576
    sample.memoryUsedMiB = Number(mem.readBigUInt64LE(16)) / 1048576
  } else {
    errors.push('memory')
  }

  const tempBuf = Buffer.alloc(4)
  if (f.nvmlDeviceGetTemperature(handle, 0, tempBuf) === NVML_SUCCESS) {
    sample.temperatureC = tempBuf.readUInt32LE(0)
  }

  const powerBuf = Buffer.alloc(4)
  if (f.nvmlDeviceGetPowerUsage(handle, powerBuf) === NVML_SUCCESS) {
    sample.powerW = round1(powerBuf.readUInt32LE(0) / 1000)
  }
  const limitBuf = Buffer.alloc(4)
  if (f.nvmlDeviceGetPowerManagementLimit(handle, limitBuf) === NVML_SUCCESS) {
    sample.powerLimitW = round1(limitBuf.readUInt32LE(0) / 1000)
  }

  const clockBuf = Buffer.alloc(4)
  if (f.nvmlDeviceGetClockInfo(handle, 1 /* NVML_CLOCK_SM */, clockBuf) === NVML_SUCCESS) {
    sample.clockMhz = clockBuf.readUInt32LE(0)
  }
  const memClockBuf = Buffer.alloc(4)
  if (f.nvmlDeviceGetClockInfo(handle, 2 /* NVML_CLOCK_MEM */, memClockBuf) === NVML_SUCCESS) {
    sample.memClockMhz = memClockBuf.readUInt32LE(0)
  }

  // Compute processes. The count and the array come from one call; pass a
  // generously sized array so NVML fills both (a too-small buffer yields
  // NVML_ERROR_INSUFFICIENT_SIZE). Re-query with an exact buffer if needed.
  const rowSize = nvml.C.sizes['struct_nvmlProcessInfo_st']
  const MAX_PROCS = 256
  const countBuf = Buffer.alloc(4)
  let rows = Buffer.alloc(rowSize * MAX_PROCS)
  let procRet = f.nvmlDeviceGetComputeRunningProcesses_v3(handle, countBuf, rows)
  if (procRet === 7 /* INSUFFICIENT_SIZE */) {
    rows = Buffer.alloc(rowSize * Math.max(countBuf.readUInt32LE(0), 1))
    procRet = f.nvmlDeviceGetComputeRunningProcesses_v3(handle, countBuf, rows)
  }
  if (procRet === NVML_SUCCESS) {
    const n = countBuf.readUInt32LE(0)
    for (let i = 0; i < n; i++) {
      const off = i * rowSize
      const pid = rows.readUInt32LE(off)
      const proc: GpuProcess = { pid }
      const name = procName(pid)
      if (name) proc.name = name
      const usedBytes = Number(rows.readBigUInt64LE(off + 8))
      proc.usedMemoryMiB = round1(usedBytes / 1048576)
      sample.processes.push(proc)
    }
  } else if (procRet !== 9 /* NOT_SUPPORTED */ && procRet !== 11 /* NO_DATA */) {
    errors.push(`processes (${errText(nvml, procRet)})`)
  }

  if (errors.length > 0) sample.error = errors.join(', ')
  return sample
}

/**
 * One full-fidelity fleet sample. Never throws.
 * @param source - label for partial/failed samples (keeps the last source the
 *   pane should trust when the sample degrades mid-run).
 */
export async function sampleNvml(): Promise<GpuFleetSnapshot> {
  const at = Date.now()
  try {
    const nvml = await loadNvml()
    const f = nvml.C.functions

    const countBuf = Buffer.alloc(4)
    const countRet = f.nvmlDeviceGetCount_v2(countBuf)
    if (countRet !== NVML_SUCCESS) {
      return { ok: false, source: 'nvml', sampledAt: at, error: errText(nvml, countRet), gpus: [] }
    }
    const count = countBuf.readUInt32LE(0)

    const driverBuf = Buffer.alloc(80)
    let driverVersion: string | undefined
    if (f.nvmlSystemGetDriverVersion(driverBuf, 80) === NVML_SUCCESS) {
      driverVersion = readCString(driverBuf) || undefined
    }

    const gpus: GpuSample[] = []
    for (let i = 0; i < count; i++) {
      gpus.push(sampleDevice(nvml, i))
    }
    return { ok: true, source: 'nvml', sampledAt: at, driverVersion, gpus }
  } catch (error) {
    return {
      ok: false,
      source: 'nvml',
      sampledAt: at,
      error: error instanceof Error ? error.message : String(error),
      gpus: [],
    }
  }
}
