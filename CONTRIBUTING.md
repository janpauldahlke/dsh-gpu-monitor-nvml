# Contributing

Thanks for poking at this. It is a small dual-face DeepSeek Harness plugin
(host sampler + web client pane). Keep changes focused.

## Setup

```sh
git clone https://github.com/janpauldahlke/dsh-gpu-monitor-nvml.git
cd dsh-gpu-monitor-nvml
npm install
node build.mjs
dsh plugin --profile web add "$PWD"
# restart dsh web; hard-refresh the browser
```

You need an NVIDIA GPU + driver to see real metrics. Without one, the API still
answers; samples will be empty / error-labeled.

## Layout

| Path | Role |
| --- | --- |
| `src/host/` | Cordis plugin, 1 Hz sampler, `/api/dsh-gpu-monitor` |
| `src/client/` | Rightbar tab + dock chip (inline styles only) |
| `src/shared/` | Snapshot types shared by both faces |
| `build.mjs` | esbuild → `lib/index.js` + `lib/client.js` |
| `cordis.patch.yml` | Loader row (`name` must match `package.json`) |

Client runtime may only `require` frozen DSH platform modules (react, cordis,
store, ui slots/primitives/dockkit). Everything else is bundled.

## Rules of the road

1. **Honesty over polish.** Label the source (`nvml` / `smi`). Never invent
   metrics. Stale or missing fields stay missing — no fake zeros on sparklines.
2. **Sampler never throws.** Host `sample*` paths catch and return `ok: false`
   (or partial GPU rows). Boot must not die on GPU errors.
3. **Rebuild after edits:** `node build.mjs`. Commit updated `lib/` when you
   change behavior so install-without-toolchain keeps working.
4. **Windows:** `node-nvml` is Linux-only today; keep the `nvidia-smi` path
   robust (PATH / `.exe` / NVSMI). We do not have an in-house Windows box —
   report results in an issue if you test there.
5. **No secrets** in screenshots, logs, or commits. Crop UI chrome; no
   `/home/<user>` session titles.

## Verify locally

```sh
dsh --profile web --dump-config | grep dsh-gpu-monitor-nvml
curl -s http://127.0.0.1:3080/api/dsh-gpu-monitor   # adjust port
# compare util / VRAM / power against `nvidia-smi` while a workload runs
```

## Pull requests

- One concern per PR (host / client / docs / Windows harden).
- Say what you ran (Linux NVML, Windows smi, no GPU).
- Match existing style: small files, typed samples, inline client styles.
- Bump `package.json` `version` only when we intentionally cut a release.

## Out of scope (for now)

- AMD / Intel / macOS metrics
- Shipping a Windows NVML `.node` ourselves (upstream `node-nvml` / Zig build)
- DeepSeek Harness core PRs — this stays an out-of-tree plugin on dsh.pub

Questions or Windows smoke reports: open a GitHub issue.
