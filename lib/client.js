window.__ModuleLoader__.load({ id: "dsh-gpu-monitor-nvml", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/GpuBody.tsx
var import_react2 = require("react");

// src/client/aggregate.ts
var VRAM_WARN = 90;
var VRAM_CRIT = 97;
var TEMP_WARN = 80;
var TEMP_CRIT = 88;
var POWER_WARN_FRAC = 0.9;
var POWER_CRIT_FRAC = 1;
function vramPct(gpu) {
  if (gpu.memoryUsedMiB == null || gpu.memoryTotalMiB == null || gpu.memoryTotalMiB <= 0) return void 0;
  return gpu.memoryUsedMiB / gpu.memoryTotalMiB * 100;
}
function powerFrac(gpu) {
  if (gpu.powerW == null || gpu.powerLimitW == null || gpu.powerLimitW <= 0) return void 0;
  return gpu.powerW / gpu.powerLimitW;
}
function levelFor(value, warn, crit) {
  if (value == null) return "na";
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "ok";
}
function gpuLevels(gpu) {
  return {
    vram: levelFor(vramPct(gpu), VRAM_WARN, VRAM_CRIT),
    temp: levelFor(gpu.temperatureC, TEMP_WARN, TEMP_CRIT),
    power: levelFor(powerFrac(gpu), POWER_WARN_FRAC, POWER_CRIT_FRAC)
  };
}
var RANK = { ok: 0, warn: 1, crit: 2 };
function worstLevel(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}
function gpuWorst(gpu) {
  const l = gpuLevels(gpu);
  const vram = l.vram === "na" ? "ok" : l.vram;
  const temp = l.temp === "na" ? "ok" : l.temp;
  const power = l.power === "na" ? "ok" : l.power;
  return worstLevel(worstLevel(vram, temp), power);
}
function fleetWorst(snap) {
  if (!snap) return "ok";
  return snap.gpus.reduce((worst, g) => worstLevel(worst, gpuWorst(g)), "ok");
}
function fleetPeakUtil(snap) {
  if (!snap) return 0;
  return snap.gpus.reduce((m, g) => Math.max(m, g.utilization ?? 0), 0);
}
function fleetPeakPower(snap) {
  if (!snap) return 0;
  return snap.gpus.reduce((m, g) => Math.max(m, g.powerW ?? 0), 0);
}
function fleetPeakVram(snap) {
  if (!snap) return 0;
  return snap.gpus.reduce((m, g) => Math.max(m, vramPct(g) ?? 0), 0);
}

// src/client/useGpu.ts
var import_react = require("react");

// src/client/store.ts
var API_PATH = "/api/dsh-gpu-monitor";
var POLL_MS = 1e3;
var snapshot = null;
var error = null;
var lastOk = null;
var lastAttempt = null;
var listeners = /* @__PURE__ */ new Set();
var timer = null;
var inFlight = false;
function emit() {
  for (const l of [...listeners]) l();
}
function start() {
  if (timer !== null || inFlight) return;
  void tick();
}
function stopIfIdle() {
  if (listeners.size > 0) return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch(API_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`poll failed: HTTP ${res.status}`);
    const data = await res.json();
    snapshot = data;
    error = null;
    lastOk = Date.now();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    lastAttempt = Date.now();
    inFlight = false;
    emit();
    if (listeners.size > 0) {
      if (timer === null) timer = setTimeout(() => {
        timer = null;
        void tick();
      }, POLL_MS);
    }
  }
}
function subscribe(listener) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    stopIfIdle();
  };
}
function getSnapshot() {
  return snapshot;
}
function getPollError() {
  return error;
}
function getLastOk() {
  return lastOk;
}
function getLastAttempt() {
  return lastAttempt;
}

// src/client/useGpu.ts
function readLive() {
  const snapshot2 = getSnapshot();
  return {
    snapshot: snapshot2,
    error: getPollError(),
    lastOk: getLastOk(),
    now: getLastAttempt() ?? Date.now(),
    peakUtil: fleetPeakUtil(snapshot2),
    peakVram: fleetPeakVram(snapshot2),
    peakPower: fleetPeakPower(snapshot2),
    worst: fleetWorst(snapshot2)
  };
}
function useGpuLive() {
  const [live, setLive] = (0, import_react.useState)(readLive);
  (0, import_react.useEffect)(() => {
    const unsubscribe = subscribe(() => setLive(readLive()));
    return unsubscribe;
  }, []);
  return live;
}

// src/client/GpuTitle.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function gbytes(miB) {
  const gb = miB / 1024;
  if (!Number.isFinite(gb)) return "\u2014";
  return gb >= 10 ? `${Math.round(gb)}` : gb.toFixed(1);
}
function gpuTooltipLine(g) {
  return `${g.index}: ${Math.round(g.utilization ?? 0)}% util \xB7 ${gbytes(g.memoryUsedMiB ?? 0)}/${gbytes(g.memoryTotalMiB ?? 0)}G \xB7 ${g.name}`;
}
function Sep() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "color-mix(in srgb, currentColor 35%, transparent)", fontWeight: 400 }, children: "\xB7" });
}
function GpuTitle() {
  const { snapshot: snapshot2, now, lastOk: lastOk2, worst } = useGpuLive();
  const gpus = snapshot2?.gpus ?? [];
  const hasData = gpus.length > 0;
  const stale = hasData && lastOk2 !== null && now - lastOk2 > 3e3;
  let dot = "#8b93a7";
  if (hasData) {
    dot = worst === "crit" ? "#ef4444" : worst === "warn" ? "#f59e0b" : "#22c55e";
  }
  let utilPct = 0;
  let usedMiB = 0;
  let totalMiB = 0;
  if (hasData) {
    const sumUtil = gpus.reduce((sum, g) => sum + (g.utilization ?? 0), 0);
    utilPct = gpus.length === 1 ? gpus[0].utilization ?? 0 : sumUtil / gpus.length;
    for (const g of gpus) {
      usedMiB += g.memoryUsedMiB ?? 0;
      totalMiB += g.memoryTotalMiB ?? 0;
    }
  }
  const title = gpus.length > 1 ? gpus.map(gpuTooltipLine).join("\n") : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "span",
    {
      title,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
        opacity: stale ? 0.5 : 1,
        transition: "opacity 200ms"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            style: {
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: dot,
              display: "inline-block",
              boxShadow: hasData && !stale ? `0 0 6px ${dot}` : "none"
            }
          }
        ),
        "GPU",
        hasData && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sep, {}),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontVariantNumeric: "tabular-nums", fontWeight: 700 }, children: [
            Math.round(utilPct),
            "%"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sep, {}),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontVariantNumeric: "tabular-nums", fontWeight: 700 }, children: [
            gbytes(usedMiB),
            "/",
            gbytes(totalMiB),
            "G"
          ] })
        ] })
      ]
    }
  );
}

// src/client/paneState.ts
var openCount = 0;
var listeners2 = /* @__PURE__ */ new Set();
function setPaneOpen(open) {
  const next = open ? openCount + 1 : Math.max(0, openCount - 1);
  if (next === openCount) return;
  openCount = next;
  for (const listener of [...listeners2]) listener();
}
function isPaneOpen() {
  return openCount > 0;
}
function subscribePaneOpen(listener) {
  listeners2.add(listener);
  return () => {
    listeners2.delete(listener);
  };
}

// src/client/GpuBody.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var HISTORY_MS = 12e4;
var HISTORY_MAX = 120;
function clampPct(v) {
  if (v === void 0 || !Number.isFinite(v)) return void 0;
  return Math.max(0, Math.min(100, v));
}
function gib(mib) {
  if (mib === void 0 || !Number.isFinite(mib)) return "\u2014";
  return `${(mib / 1024).toFixed(1)} GiB`;
}
function pct(v) {
  if (v === void 0 || !Number.isFinite(v)) return "\u2014";
  return `${Math.round(v)} %`;
}
function num(v, unit) {
  if (v === void 0 || !Number.isFinite(v)) return "\u2014";
  return `${Math.round(v)} ${unit}`;
}
function age(sampledAt, now) {
  const s = Math.max(0, Math.round((now - sampledAt) / 1e3));
  return `${s} s ago`;
}
function SourceBadge({ source, driver }) {
  const styles = {
    nvml: { bg: "color-mix(in srgb, currentColor 14%, transparent)", fg: "currentColor", label: "NVML" },
    smi: { bg: "color-mix(in srgb, currentColor 14%, transparent)", fg: "currentColor", label: "smi" },
    stub: { bg: "color-mix(in srgb, currentColor 8%, transparent)", fg: "currentColor", label: "no data" }
  };
  const s = styles[source] ?? styles.stub;
  const base = source === "nvml" ? "Data source: NVML driver API \u2014 full fidelity, per-process VRAM" : source === "smi" ? "Data source: nvidia-smi text fallback \u2014 some fields (per-process VRAM, memory utilization) unavailable" : "No GPU data available";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "span",
    {
      title: driver !== void 0 && driver !== "" ? `${base} (driver ${driver})` : base,
      style: {
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        background: s.bg,
        color: s.fg
      },
      children: s.label
    }
  );
}
function MetaSep() {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: "color-mix(in srgb, currentColor 35%, transparent)" }, children: "\xB7" });
}
function Meter({ frac, tooltip, tone }) {
  const w = frac === void 0 || !Number.isFinite(frac) ? 0 : Math.max(0, Math.min(1, frac)) * 100;
  const fill = tone === "crit" ? "color-mix(in srgb, #f87171 85%, currentColor)" : tone === "warn" ? "color-mix(in srgb, #fbbf24 80%, currentColor)" : "color-mix(in srgb, currentColor 60%, transparent)";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "div",
    {
      title: tooltip,
      style: {
        flex: 1,
        height: 4,
        borderRadius: 2,
        background: "color-mix(in srgb, currentColor 10%, transparent)",
        overflow: "hidden",
        cursor: "default"
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "div",
        {
          style: {
            width: `${w}%`,
            height: "100%",
            borderRadius: 2,
            background: fill,
            transition: "width 0.6s linear"
          }
        }
      )
    }
  );
}
function Row({ label, tooltip, value, caption, meter, tone }) {
  const valueColor = tone === "crit" ? "#f87171" : tone === "warn" ? "#fbbf24" : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      title: tooltip,
      style: {
        display: "flex",
        alignItems: meter !== void 0 ? "center" : "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "2.5px 0",
        cursor: "default"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 11.5, color: "color-mix(in srgb, currentColor 55%, transparent)", flexShrink: 0 }, children: label }),
        meter !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Meter, { frac: meter.frac, tooltip: meter.tooltip, tone }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { textAlign: "right", flexShrink: 1, minWidth: 0 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: valueColor }, children: value }),
          caption !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "span",
            {
              style: {
                display: "block",
                fontSize: 10.5,
                color: "color-mix(in srgb, currentColor 45%, transparent)",
                fontVariantNumeric: "tabular-nums"
              },
              children: caption
            }
          )
        ] })
      ]
    }
  );
}
function Sparkline({ points, now }) {
  const t0 = now - HISTORY_MS;
  const visible = points.filter((p) => p.t >= t0);
  const x = (t) => (t - t0) / HISTORY_MS * 120;
  const y = (pct2) => 29 - pct2 / 100 * 28;
  const seriesPath = (pick) => {
    const parts = [];
    let penDown = false;
    for (const p of visible) {
      const v = pick(p);
      if (v === void 0) {
        penDown = false;
        continue;
      }
      const cmd = penDown ? "L" : "M";
      parts.push(`${cmd}${x(p.t).toFixed(1)} ${y(v).toFixed(1)}`);
      penDown = true;
    }
    return parts.join(" ");
  };
  if (visible.length < 2) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 10.5, color: "color-mix(in srgb, currentColor 45%, transparent)", fontStyle: "italic" }, children: "collecting history \u2014 sparklines appear after a few samples" });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "svg",
      {
        width: "100%",
        height: 30,
        viewBox: "0 0 120 30",
        preserveAspectRatio: "none",
        style: { display: "block" },
        "aria-hidden": "true",
        children: [
          [25, 50, 75].map((g) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "line",
            {
              x1: 0,
              x2: 120,
              y1: y(g),
              y2: y(g),
              stroke: "currentColor",
              strokeOpacity: 0.08,
              strokeWidth: 1,
              vectorEffect: "non-scaling-stroke"
            },
            g
          )),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: seriesPath((p) => p.power), fill: "none", stroke: "currentColor", strokeOpacity: 0.35, strokeWidth: 1, strokeDasharray: "3 2", vectorEffect: "non-scaling-stroke" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: seriesPath((p) => p.vram), fill: "none", stroke: "currentColor", strokeOpacity: 0.5, strokeWidth: 1.25, vectorEffect: "non-scaling-stroke" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: seriesPath((p) => p.util), fill: "none", stroke: "currentColor", strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 10, marginTop: 2, fontSize: 10, color: "color-mix(in srgb, currentColor 55%, transparent)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { width: 10, height: 2, background: "currentColor", display: "inline-block" } }),
        "util"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { width: 10, height: 2, background: "color-mix(in srgb, currentColor 50%, transparent)", display: "inline-block" } }),
        "vram"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { width: 10, height: 2, borderTop: "2px dotted currentColor", display: "inline-block" } }),
        "power"
      ] })
    ] })
  ] });
}
function GpuCard({ gpu, points, now }) {
  const [expanded, setExpandedState] = (0, import_react2.useState)(() => {
    try {
      return localStorage.getItem(`dsh.gpuMonitor.card.${gpu.index}`) === "1";
    } catch {
      return false;
    }
  });
  const setExpanded = (next) => {
    setExpandedState(next);
    try {
      localStorage.setItem(`dsh.gpuMonitor.card.${gpu.index}`, next ? "1" : "0");
    } catch {
    }
  };
  const [hover, setHover] = (0, import_react2.useState)(false);
  const showName = gpu.name !== void 0 && gpu.name !== `GPU ${gpu.index}`;
  const levels = gpuLevels(gpu);
  const worst = gpuWorst(gpu);
  const vramPctValue = vramPct(gpu);
  const powerFracValue = powerFrac(gpu);
  const cardBorder = worst === "crit" ? "1px solid color-mix(in srgb, #f87171 60%, transparent)" : worst === "warn" ? "1px solid color-mix(in srgb, #fbbf24 45%, transparent)" : "1px solid color-mix(in srgb, currentColor 18%, transparent)";
  const toneColor = (lv) => lv === "warn" ? "color-mix(in srgb, #fbbf24 75%, currentColor)" : lv === "crit" ? "color-mix(in srgb, #f87171 80%, currentColor)" : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { border: cardBorder, borderRadius: 8, overflow: "hidden" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "div",
      {
        role: "button",
        tabIndex: 0,
        "aria-expanded": expanded,
        title: "Click to expand: full metric rows, 2-minute trend, per-process VRAM",
        onClick: () => setExpanded(!expanded),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 10px",
          cursor: "pointer",
          userSelect: "none",
          background: hover ? "color-mix(in srgb, currentColor 6%, transparent)" : "transparent",
          transition: "background 120ms"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "span",
            {
              "aria-hidden": true,
              style: {
                display: "inline-block",
                fontSize: 10,
                lineHeight: 1,
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 150ms",
                color: "color-mix(in srgb, currentColor 50%, transparent)"
              },
              children: "\u25B8"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "span",
            {
              style: {
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.05em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "color-mix(in srgb, currentColor 12%, transparent)",
                whiteSpace: "nowrap"
              },
              children: [
                "GPU ",
                gpu.index
              ]
            }
          ),
          showName && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: gpu.name, children: gpu.name }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "span",
            {
              style: {
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "baseline",
                gap: 8,
                flexWrap: "wrap",
                fontVariantNumeric: "tabular-nums",
                fontSize: 11,
                color: "color-mix(in srgb, currentColor 75%, transparent)"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: "GPU compute utilization", style: { whiteSpace: "nowrap" }, children: gpu.utilization !== void 0 && Number.isFinite(gpu.utilization) ? `${Math.round(gpu.utilization)}%` : "\u2014" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: "VRAM used / total", style: { whiteSpace: "nowrap", ...toneColor(levels.vram) ? { color: toneColor(levels.vram) } : {} }, children: gpu.memoryUsedMiB !== void 0 && gpu.memoryTotalMiB !== void 0 ? `${gbytes(gpu.memoryUsedMiB)}/${gbytes(gpu.memoryTotalMiB)}G` : "\u2014" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: "GPU core temperature", style: { whiteSpace: "nowrap", ...toneColor(levels.temp) ? { color: toneColor(levels.temp) } : {} }, children: gpu.temperatureC !== void 0 && Number.isFinite(gpu.temperatureC) ? `${Math.round(gpu.temperatureC)}\xB0C` : "\u2014" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: "Power draw", style: { whiteSpace: "nowrap", ...toneColor(levels.power) ? { color: toneColor(levels.power) } : {} }, children: gpu.powerW !== void 0 && Number.isFinite(gpu.powerW) ? `${Math.round(gpu.powerW)}W` : "\u2014" })
              ]
            }
          )
        ]
      }
    ),
    expanded && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px 8px", borderTop: "1px solid color-mix(in srgb, currentColor 12%, transparent)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: "GPU util",
          tooltip: "GPU compute utilization \u2014 percent of the last sample interval in which at least one kernel was executing on the GPU (NVML utilization.gpu). A value of 0 means idle, not \u201Cno data\u201D. The meter shows the share of the 100 % scale.",
          value: pct(gpu.utilization),
          meter: { frac: gpu.utilization !== void 0 ? gpu.utilization / 100 : void 0, tooltip: `GPU util ${pct(gpu.utilization)} of 100 %` }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: "Mem util",
          tooltip: "Memory-bus utilization \u2014 percent of the last sample interval in which the memory interface was active transferring data (NVML utilization.memory). This is bandwidth activity, NOT how much VRAM is occupied. The meter shows the share of the 100 % scale.",
          value: pct(gpu.memoryUtilization),
          meter: { frac: gpu.memoryUtilization !== void 0 ? gpu.memoryUtilization / 100 : void 0, tooltip: `Mem util ${pct(gpu.memoryUtilization)} of 100 %` }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: "VRAM",
          tooltip: "Video RAM. Used = total \u2212 free as reported by the driver (NVML), so it includes ~0.4 GiB of driver/context reservation and reads higher than nvidia-smi's per-process column. Free is the driver's own number, not total minus process usage.",
          value: `${gib(gpu.memoryUsedMiB)} / ${gib(gpu.memoryTotalMiB)}`,
          caption: gpu.memoryFreeMiB !== void 0 ? `${gib(gpu.memoryFreeMiB)} free` : void 0,
          meter: {
            frac: vramPctValue !== void 0 ? vramPctValue / 100 : void 0,
            tooltip: `VRAM ${pct(vramPctValue)} of total`
          },
          tone: levels.vram
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: "Temp",
          tooltip: "GPU core temperature \u2014 hottest on-die sensor reported by the driver (NVML temperature, sensor 0).",
          value: num(gpu.temperatureC, "\xB0C"),
          tone: levels.temp
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: "Power draw",
          tooltip: "Instantaneous power draw across all GPU rails (NVML total power). The caption is the currently configured power limit, not a measured maximum.",
          value: gpu.powerW !== void 0 ? `${gpu.powerW.toFixed(1)} W` : "\u2014",
          caption: gpu.powerLimitW !== void 0 ? `limit ${gpu.powerLimitW.toFixed(0)} W` : void 0,
          meter: {
            frac: powerFracValue,
            tooltip: `Power ${gpu.powerW !== void 0 ? gpu.powerW.toFixed(1) : "\u2014"} W of the ${gpu.powerLimitW !== void 0 ? `${gpu.powerLimitW.toFixed(0)} W` : "\u2014"} limit`
          },
          tone: levels.power
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: "SM clock",
          tooltip: "Graphics/SM (shader) clock \u2014 the speed at which the compute cores are currently running (NVML graphics clock). It drops automatically under power or thermal pressure.",
          value: num(gpu.clockMhz, "MHz")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: "Mem clock",
          tooltip: "Memory (GDDR) clock rate \u2014 the speed of the VRAM interface (NVML memory clock). Distinct from SM clock and from mem utilization.",
          value: num(gpu.memClockMhz, "MHz")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: 6, paddingTop: 5, borderTop: "1px solid color-mix(in srgb, currentColor 12%, transparent)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "div",
          {
            title: "Rolling trend over the last 2 minutes (one point per second). All three series share a fixed 0-100 % scale so they are directly comparable: GPU compute utilization, VRAM occupancy, and power draw as a share of the configured limit. Gaps mean the metric was unavailable for that second.",
            style: { fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "color-mix(in srgb, currentColor 45%, transparent)", marginBottom: 4, cursor: "default" },
            children: "Trend \xB7 last 2 min"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Sparkline, { points, now })
      ] }),
      gpu.processes.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: 6, paddingTop: 5, borderTop: "1px solid color-mix(in srgb, currentColor 12%, transparent)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "color-mix(in srgb, currentColor 45%, transparent)", marginBottom: 2 }, children: "Processes \xB7 VRAM" }),
        gpu.processes.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "div",
          {
            title: `Process ${p.name ?? "unknown"} (pid ${p.pid}) is using ${gib(p.usedMemoryMiB)} of this GPU's VRAM`,
            style: {
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              padding: "1px 0",
              fontSize: 11.5
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontWeight: 600 }, children: p.name ?? `pid ${p.pid}` }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: "color-mix(in srgb, currentColor 45%, transparent)", marginLeft: 6, fontVariantNumeric: "tabular-nums" }, children: p.name ? `pid ${p.pid}` : "" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }, children: gib(p.usedMemoryMiB) })
            ]
          },
          p.pid
        ))
      ] }),
      gpu.error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { marginTop: 6, fontSize: 11, color: "color-mix(in srgb, currentColor 70%, transparent)", fontStyle: "italic" }, children: gpu.error })
    ] })
  ] });
}
function GpuBody() {
  const live = useGpuLive();
  const snap = live.snapshot;
  const now = live.now;
  const historyRef = (0, import_react2.useRef)(/* @__PURE__ */ new Map());
  (0, import_react2.useEffect)(() => {
    if (!live.snapshot) return;
    const t = Date.now();
    const history = historyRef.current;
    for (const g of live.snapshot.gpus) {
      const pts = history.get(g.index) ?? [];
      pts.push({
        t,
        util: clampPct(g.utilization),
        vram: g.memoryUsedMiB !== void 0 && g.memoryTotalMiB !== void 0 && g.memoryTotalMiB > 0 ? clampPct(g.memoryUsedMiB / g.memoryTotalMiB * 100) : void 0,
        power: g.powerW !== void 0 && g.powerLimitW !== void 0 && g.powerLimitW > 0 ? clampPct(g.powerW / g.powerLimitW * 100) : void 0
      });
      const cutoff = t - HISTORY_MS;
      let drop = 0;
      while (drop < pts.length && pts[drop].t < cutoff) drop++;
      if (drop > 0) pts.splice(0, drop);
      if (pts.length > HISTORY_MAX) pts.splice(0, pts.length - HISTORY_MAX);
      history.set(g.index, pts);
    }
  }, [live.snapshot]);
  (0, import_react2.useEffect)(() => {
    setPaneOpen(true);
    return () => setPaneOpen(false);
  }, []);
  const stale = snap !== null && live.lastOk !== null && now - live.lastOk > 3e3;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12, userSelect: "text" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          columnGap: 8,
          padding: "8px 10px",
          borderBottom: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
          fontSize: 11,
          color: "color-mix(in srgb, currentColor 55%, transparent)",
          fontVariantNumeric: "tabular-nums"
        },
        children: [
          snap ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SourceBadge, { source: snap.source, driver: snap.driverVersion }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MetaSep, {}),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
              snap.gpus.length,
              " GPU",
              snap.gpus.length === 1 ? "" : "s"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MetaSep, {}),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "span",
              {
                title: live.error ? "Age of the last successful sample \u2014 the poll is currently failing" : "Age of the last successful sample",
                children: live.lastOk !== null ? `last updated ${age(live.lastOk, now)}` : "\u2026"
              }
            ),
            stale && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MetaSep, {}),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "span",
                {
                  title: "No successful sample in the last 3 s \u2014 showing the last one, which may be stale",
                  style: { fontStyle: "italic" },
                  children: "stale (> 3 s)"
                }
              )
            ] }),
            live.error && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MetaSep, {}),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "span",
                {
                  title: live.error,
                  style: { fontStyle: "italic", color: "color-mix(in srgb, currentColor 70%, transparent)" },
                  children: [
                    "poll error: ",
                    live.error
                  ]
                }
              )
            ] })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "waiting for first sample\u2026" }),
          !snap && live.error && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MetaSep, {}),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "span",
              {
                title: live.error,
                style: { fontStyle: "italic", color: "color-mix(in srgb, currentColor 70%, transparent)" },
                children: [
                  "poll error: ",
                  live.error
                ]
              }
            )
          ] })
        ]
      }
    ),
    snap && snap.ok === false && snap.error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 11.5, padding: "8px 10px", border: "1px solid color-mix(in srgb, currentColor 25%, transparent)", borderRadius: 6, fontStyle: "italic" }, children: snap.error }),
    snap && snap.gpus.map((gpu) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GpuCard, { gpu, points: historyRef.current.get(gpu.index) ?? [], now }, gpu.uuid ?? gpu.index)),
    snap === null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 11.5, color: "color-mix(in srgb, currentColor 55%, transparent)", fontStyle: "italic" }, children: "Sampling GPUs at 1 Hz \u2014 first sample arrives within a second." })
  ] });
}

// src/client/GpuDockChip.tsx
var import_react3 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function GpuDockChip({ onOpen }) {
  const { snapshot: snapshot2, now, lastOk: lastOk2, worst, peakUtil } = useGpuLive();
  const [paneOpen, setPaneOpenState] = (0, import_react3.useState)(isPaneOpen);
  (0, import_react3.useEffect)(() => subscribePaneOpen(() => setPaneOpenState(isPaneOpen())), []);
  if (paneOpen) return null;
  const gpus = snapshot2?.gpus ?? [];
  const hasData = gpus.length > 0;
  const stale = hasData && lastOk2 !== null && now - lastOk2 > 3e3;
  let dot = "#8b93a7";
  if (hasData) {
    dot = worst === "crit" ? "#ef4444" : worst === "warn" ? "#f59e0b" : "#22c55e";
  }
  let usedMiB = 0;
  let totalMiB = 0;
  let title = "GPU monitoring \u2014 waiting for first sample";
  if (hasData) {
    for (const g of gpus) {
      usedMiB += g.memoryUsedMiB ?? 0;
      totalMiB += g.memoryTotalMiB ?? 0;
    }
    const lines = gpus.map(gpuTooltipLine);
    if (stale && lastOk2 !== null) {
      lines.push("", `stale \u2014 last updated ${Math.max(1, Math.round((now - lastOk2) / 1e3))} s ago`);
    }
    title = lines.join("\n");
  }
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "button",
    {
      type: "button",
      onClick: onOpen,
      title,
      "aria-label": "Open GPU monitor pane",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
        padding: "1px 8px",
        borderRadius: 999,
        border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
        background: "color-mix(in srgb, currentColor 6%, transparent)",
        color: "inherit",
        cursor: "pointer",
        opacity: stale ? 0.55 : 1,
        transition: "opacity 200ms"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "span",
          {
            style: {
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: dot,
              display: "inline-block",
              boxShadow: hasData && !stale ? `0 0 5px ${dot}` : "none"
            }
          }
        ),
        "GPU",
        hasData && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: "color-mix(in srgb, currentColor 35%, transparent)", fontWeight: 400 }, children: "\xB7" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { fontVariantNumeric: "tabular-nums" }, children: [
            Math.round(peakUtil),
            "% \xB7 ",
            gbytes(usedMiB),
            "/",
            gbytes(totalMiB),
            "G"
          ] })
        ] })
      ]
    }
  );
}

// src/client/index.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var TAB_ID = "dsh-gpu-monitor";
var inject = ["slots", "sidebarRight", "sidebarRightTabs"];
function apply(ctx) {
  const definition = {
    id: TAB_ID,
    kind: "gpu-monitor",
    title: () => "GPU Monitor",
    guide: [{
      id: "gpu-monitor",
      order: 200,
      title: () => "GPU Monitor",
      description: () => "Live NVIDIA GPU utilization, memory, power and clocks"
    }]
  };
  const disposeType = ctx.sidebarRightTabs.register(definition);
  const disposeBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab", key: TAB_ID },
    GpuBody
  ));
  const disposeTitle = ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab.title", key: TAB_ID },
    GpuTitle
  ));
  const GpuDockSeat = () => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(GpuDockChip, { onOpen: () => ctx.sidebarRight.openTab("gpu-monitor") });
  const disposeDock = ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register(
    { name: "conversation.composer.dock", id: "gpu-monitor", order: -10 },
    GpuDockSeat
  ));
  ctx.effect(() => () => {
    disposeDock();
    disposeTitle();
    disposeBody();
    disposeType();
  }, "gpu-monitor: rightbar tab type");
}
return module.exports; } });
//# sourceMappingURL=client.js.map
