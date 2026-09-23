// src/host/collect.ts
import { readFileSync } from "node:fs";

// src/shared/types.ts
function round1(x) {
  return Math.round(x * 10) / 10;
}

// src/host/collect.ts
var NVML_ERRORS = {
  2: "no NVIDIA devices found",
  3: "driver not loaded",
  13: "invalid argument",
  22: "driver not ready",
  23: "function not found (binding/driver mismatch)"
};
var NVML_SUCCESS = 0;
var binding;
async function loadNvml() {
  if (binding !== void 0) return binding;
  const mod = await import("node-nvml");
  const inst = mod.default?.default ?? mod.default;
  if (!inst?.C?.functions) throw new Error("node-nvml binding has no C functions");
  binding = inst;
  return inst;
}
function errText(nvml, ret) {
  const named = NVML_ERRORS[ret];
  if (named) return `NVML error ${ret}: ${named}`;
  try {
    const buf = Buffer.alloc(80);
    const r = nvml.C.functions.nvmlErrorString(ret, buf);
    if (r === NVML_SUCCESS) {
      const text = buf.toString("utf8", 0, buf.indexOf(0)).trim();
      if (text) return `NVML error ${ret}: ${text}`;
    }
  } catch {
  }
  return `NVML error ${ret}`;
}
function struct(nvml, type) {
  const size = nvml.C.sizes[type];
  if (!size) throw new Error(`unknown NVML struct ${type}`);
  return Buffer.alloc(size);
}
function cell() {
  const buf = Buffer.alloc(8);
  return buf;
}
function readCString(buf) {
  const end = buf.indexOf(0);
  return buf.toString("utf8", 0, end === -1 ? buf.length : end);
}
function procName(pid) {
  if (process.platform !== "linux") return void 0;
  try {
    const raw = readFileSync(`/proc/${pid}/comm`, "utf8");
    return raw.trim() || void 0;
  } catch {
    return void 0;
  }
}
function sampleDevice(nvml, index) {
  const f = nvml.C.functions;
  const handle = cell();
  const ret = f.nvmlDeviceGetHandleByIndex_v2(index, handle);
  if (ret !== NVML_SUCCESS) {
    return { index, name: `GPU ${index}`, processes: [], error: errText(nvml, ret) };
  }
  const sample = { index, name: `GPU ${index}`, processes: [] };
  const errors = [];
  const nameBuf = Buffer.alloc(256);
  if (f.nvmlDeviceGetName(handle, nameBuf, 256) === NVML_SUCCESS) {
    sample.name = readCString(nameBuf);
  }
  const uuidBuf = Buffer.alloc(96);
  if (f.nvmlDeviceGetUUID(handle, uuidBuf, 96) === NVML_SUCCESS) {
    sample.uuid = readCString(uuidBuf) || void 0;
  }
  const util = struct(nvml, "struct_nvmlUtilization_st");
  if (f.nvmlDeviceGetUtilizationRates(handle, util) === NVML_SUCCESS) {
    sample.utilization = util.readUInt32LE(0);
    sample.memoryUtilization = util.readUInt32LE(4);
  } else {
    errors.push("utilization");
  }
  const mem = struct(nvml, "struct_nvmlMemory_st");
  if (f.nvmlDeviceGetMemoryInfo(handle, mem) === NVML_SUCCESS) {
    sample.memoryTotalMiB = Number(mem.readBigUInt64LE(0)) / 1048576;
    sample.memoryFreeMiB = Number(mem.readBigUInt64LE(8)) / 1048576;
    sample.memoryUsedMiB = Number(mem.readBigUInt64LE(16)) / 1048576;
  } else {
    errors.push("memory");
  }
  const tempBuf = Buffer.alloc(4);
  if (f.nvmlDeviceGetTemperature(handle, 0, tempBuf) === NVML_SUCCESS) {
    sample.temperatureC = tempBuf.readUInt32LE(0);
  }
  const powerBuf = Buffer.alloc(4);
  if (f.nvmlDeviceGetPowerUsage(handle, powerBuf) === NVML_SUCCESS) {
    sample.powerW = round1(powerBuf.readUInt32LE(0) / 1e3);
  }
  const limitBuf = Buffer.alloc(4);
  if (f.nvmlDeviceGetPowerManagementLimit(handle, limitBuf) === NVML_SUCCESS) {
    sample.powerLimitW = round1(limitBuf.readUInt32LE(0) / 1e3);
  }
  const clockBuf = Buffer.alloc(4);
  if (f.nvmlDeviceGetClockInfo(handle, 1, clockBuf) === NVML_SUCCESS) {
    sample.clockMhz = clockBuf.readUInt32LE(0);
  }
  const memClockBuf = Buffer.alloc(4);
  if (f.nvmlDeviceGetClockInfo(handle, 2, memClockBuf) === NVML_SUCCESS) {
    sample.memClockMhz = memClockBuf.readUInt32LE(0);
  }
  const rowSize = nvml.C.sizes["struct_nvmlProcessInfo_st"];
  const MAX_PROCS = 256;
  const countBuf = Buffer.alloc(4);
  let rows = Buffer.alloc(rowSize * MAX_PROCS);
  let procRet = f.nvmlDeviceGetComputeRunningProcesses_v3(handle, countBuf, rows);
  if (procRet === 7) {
    rows = Buffer.alloc(rowSize * Math.max(countBuf.readUInt32LE(0), 1));
    procRet = f.nvmlDeviceGetComputeRunningProcesses_v3(handle, countBuf, rows);
  }
  if (procRet === NVML_SUCCESS) {
    const n = countBuf.readUInt32LE(0);
    for (let i = 0; i < n; i++) {
      const off = i * rowSize;
      const pid = rows.readUInt32LE(off);
      const proc = { pid };
      const name2 = procName(pid);
      if (name2) proc.name = name2;
      const usedBytes = Number(rows.readBigUInt64LE(off + 8));
      proc.usedMemoryMiB = round1(usedBytes / 1048576);
      sample.processes.push(proc);
    }
  } else if (procRet !== 9 && procRet !== 11) {
    errors.push(`processes (${errText(nvml, procRet)})`);
  }
  if (errors.length > 0) sample.error = errors.join(", ");
  return sample;
}
async function sampleNvml() {
  const at = Date.now();
  try {
    const nvml = await loadNvml();
    const f = nvml.C.functions;
    const countBuf = Buffer.alloc(4);
    const countRet = f.nvmlDeviceGetCount_v2(countBuf);
    if (countRet !== NVML_SUCCESS) {
      return { ok: false, source: "nvml", sampledAt: at, error: errText(nvml, countRet), gpus: [] };
    }
    const count = countBuf.readUInt32LE(0);
    const driverBuf = Buffer.alloc(80);
    let driverVersion;
    if (f.nvmlSystemGetDriverVersion(driverBuf, 80) === NVML_SUCCESS) {
      driverVersion = readCString(driverBuf) || void 0;
    }
    const gpus = [];
    for (let i = 0; i < count; i++) {
      gpus.push(sampleDevice(nvml, i));
    }
    return { ok: true, source: "nvml", sampledAt: at, driverVersion, gpus };
  } catch (error) {
    return {
      ok: false,
      source: "nvml",
      sampledAt: at,
      error: error instanceof Error ? error.message : String(error),
      gpus: []
    };
  }
}

// src/host/collect-smi.ts
import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
var pExecFile = promisify(execFile);
var GPU_FIELDS = [
  "index",
  "name",
  "uuid",
  "driver_version",
  "utilization.gpu",
  "utilization.memory",
  "memory.used",
  "memory.free",
  "memory.total",
  "temperature",
  "power.draw",
  "power.limit",
  "clocks.sm",
  "clocks.mem"
].join(",");
var APP_FIELDS = "pid,process_name,used_memory,gpu_uuid";
var resolvedSmi;
function winSmiCandidates() {
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const root = process.env["SystemRoot"] ?? "C:\\Windows";
  return [
    "nvidia-smi.exe",
    "nvidia-smi",
    join(root, "System32", "nvidia-smi.exe"),
    join(pf, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
    join(pf86, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")
  ];
}
function smiCandidates() {
  if (process.platform === "win32") return winSmiCandidates();
  return ["nvidia-smi"];
}
function isAbsoluteCandidate(bin) {
  return bin.includes("/") || bin.includes("\\");
}
function orderedCandidates() {
  const out = [];
  for (const bin of smiCandidates()) {
    if (isAbsoluteCandidate(bin)) {
      try {
        accessSync(bin, fsConstants.X_OK);
        out.push(bin);
      } catch {
        try {
          accessSync(bin, fsConstants.F_OK);
          out.push(bin);
        } catch {
        }
      }
    } else {
      out.push(bin);
    }
  }
  return out;
}
async function execSmi(args) {
  const bins = resolvedSmi !== void 0 ? [resolvedSmi] : orderedCandidates();
  for (const bin of bins) {
    try {
      const { stdout } = await pExecFile(bin, args, {
        timeout: 5e3,
        windowsHide: true
      });
      resolvedSmi = bin;
      return stdout;
    } catch {
    }
  }
  return void 0;
}
function parseCsv(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line) => line.split(",").map((cell2) => cell2.trim()));
}
function toNumber(cell2) {
  if (cell2 === void 0) return void 0;
  const n = Number(cell2);
  return Number.isFinite(n) ? n : void 0;
}
async function sampleSmi() {
  const at = Date.now();
  try {
    const [gpuOut, appOut] = await Promise.all([
      execSmi([
        "--query-gpu=" + GPU_FIELDS,
        "--format=csv,noheader,nounits"
      ]),
      execSmi([
        "--query-compute-apps=" + APP_FIELDS,
        "--format=csv,noheader,nounits"
      ])
    ]);
    if (gpuOut === void 0 || gpuOut.trim() === "") {
      return {
        ok: false,
        source: "smi",
        sampledAt: at,
        error: "nvidia-smi unavailable or returned no GPUs",
        gpus: []
      };
    }
    const rows = parseCsv(gpuOut);
    const gpus = [];
    for (const row of rows) {
      const get = (field) => {
        const idx = GPU_FIELDS.split(",").indexOf(field);
        return idx >= 0 ? row[idx] : void 0;
      };
      const sample = {
        index: toNumber(get("index")) ?? gpus.length,
        name: get("name") ?? "GPU",
        processes: []
      };
      const uuid = get("uuid");
      if (uuid && uuid !== "[N/A]") sample.uuid = uuid;
      sample.utilization = toNumber(get("utilization.gpu"));
      sample.memoryUtilization = toNumber(get("utilization.memory"));
      sample.memoryUsedMiB = toNumber(get("memory.used"));
      sample.memoryFreeMiB = toNumber(get("memory.free"));
      sample.memoryTotalMiB = toNumber(get("memory.total"));
      sample.temperatureC = toNumber(get("temperature"));
      sample.powerW = toNumber(get("power.draw")) === void 0 ? void 0 : round1(Number(get("power.draw")));
      sample.powerLimitW = toNumber(get("power.limit")) === void 0 ? void 0 : round1(Number(get("power.limit")));
      sample.clockMhz = toNumber(get("clocks.sm"));
      sample.memClockMhz = toNumber(get("clocks.mem"));
      gpus.push(sample);
    }
    if (appOut && appOut.trim() !== "") {
      const byGpu = /* @__PURE__ */ new Map();
      const unattributed = [];
      for (const row of parseCsv(appOut)) {
        const pid = toNumber(row[0]);
        if (pid === void 0) continue;
        const name2 = row[1] && row[1] !== "[N/A]" ? row[1] : void 0;
        const used = toNumber(row[2]);
        const uuid = row[3] && row[3] !== "[N/A]" ? row[3] : void 0;
        const proc = {
          pid,
          ...name2 ? { name: name2 } : {},
          ...used !== void 0 ? { usedMemoryMiB: round1(used) } : {}
        };
        if (uuid === void 0) {
          unattributed.push(proc);
          continue;
        }
        const list = byGpu.get(uuid);
        if (list) list.push(proc);
        else byGpu.set(uuid, [proc]);
      }
      for (const gpu of gpus) {
        if (gpu.uuid !== void 0) gpu.processes = byGpu.get(gpu.uuid) ?? [];
      }
      if (unattributed.length > 0 && gpus.length === 1) gpus[0].processes.push(...unattributed);
    }
    return {
      ok: true,
      source: "smi",
      sampledAt: at,
      driverVersion: gpus.length > 0 ? rows[0][3] && rows[0][3] !== "[N/A]" ? rows[0][3] : void 0 : void 0,
      gpus
    };
  } catch (error) {
    return {
      ok: false,
      source: "smi",
      sampledAt: at,
      error: error instanceof Error ? error.message : String(error),
      gpus: []
    };
  }
}

// src/host/route.ts
var ROUTE = "/api/dsh-gpu-monitor";

// src/host/index.ts
var name = "dsh-gpu-monitor-nvml";
var inject = ["webServer"];
var SAMPLE_INTERVAL_MS = 1e3;
var latest = { ok: true, source: "stub", sampledAt: Date.now(), gpus: [] };
var nvmlReady;
var inFlight = false;
var timer;
async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    if (nvmlReady === void 0) {
      try {
        await loadNvml();
        nvmlReady = true;
      } catch {
        nvmlReady = false;
      }
    }
    latest = nvmlReady ? await sampleNvml() : await sampleSmi();
  } catch {
  } finally {
    inFlight = false;
  }
}
function apply(ctx) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: ROUTE,
    handler: (req, res) => {
      if (req.method !== "GET") {
        res.writeHead(405, { "content-type": "text/plain" });
        res.end("method not allowed");
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(latest));
    }
  });
  ctx.effect(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, SAMPLE_INTERVAL_MS);
    timer.unref?.();
    return () => {
      if (timer !== void 0) clearInterval(timer);
      timer = void 0;
    };
  }, "gpu-monitor: sampler");
  ctx.effect(() => unregister, "gpu-monitor: /api/dsh-gpu-monitor route");
}
export {
  ROUTE,
  SAMPLE_INTERVAL_MS,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
