/**
 * dsh-gpu-monitor build: two artifacts, one package.
 *
 * - lib/index.js  — host half (ESM, node): Cordis plugin with the GPU collector
 *                   and the /api/dsh-gpu-monitor route on the harness webserver.
 * - lib/client.js — browser half (CJS closure factory): registered through
 *                   window.__ModuleLoader__ per the dsh-client-modules contract
 *                   (see packages/client/tsdown.client.ts in the harness tree).
 *
 * The client bundle keeps every import on the frozen platform baseline
 * (PLATFORM_MODULES) so dsh.client.external stays empty; the sidebar-right
 * package is needed only for type-only imports, which the compiler erases.
 */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'package.json'), 'utf8'))
const id = pkg.name

/** Frozen shell module-table baseline — the only runtime requests allowed. */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

await mkdir(join(root, 'lib'), { recursive: true })

// ---- host half ------------------------------------------------------------
await build({
  entryPoints: [join(root, 'src/host/index.ts')],
  outfile: join(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  sourcemap: true,
  // Runtime deps stay external imports (resolved from the profile's
  // node_modules); the host half's only npm dep today is node-nvml (lazy).
  external: ['node-nvml', '@deepseek-ai/*'],
  logLevel: 'warning',
})

// ---- client half ----------------------------------------------------------
await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  external: [...PLATFORM_EXTERNALS, '@deepseek-ai/*'],
  // esbuild has no `intro`; the rolldown intro line folds into the banner so
  // the artifact layout matches the harness preset exactly.
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'warning',
})

console.log(`[dsh-gpu-monitor-nvml] built lib/index.js + lib/client.js for ${id}`)
