/**
 * v1.7.0 build 5 — Default browser & OS link-handling tests (Phase 1 start).
 *
 * Covers: the pure decision logic of defaultbrowser.ts (looksLikeUs handler
 * matching across path styles, parseLaunchArgs argv extraction) and the
 * Settings page wiring (card present, bridge calls, per-state rendering).
 *
 * Run:  node scripts/test-v176.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(ROOT, '..')
const require = createRequire(import.meta.url)

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) {
    pass++
    console.log('  ✓', name)
  } else {
    fail++
    console.log('  ✗ FAIL:', name)
  }
}
function eq(a, b, name) {
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  ok(sa === sb, `${name} (got ${sa?.slice(0, 90)}, want ${sb?.slice(0, 90)})`)
}

/* ---------- bundle defaultbrowser (electron stubbed: no app calls hit) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test176-'))
const nm = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(nm, { recursive: true })
fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }))
fs.writeFileSync(
  path.join(nm, 'index.js'),
  `module.exports = { app: { setAsDefaultProtocolClient(){ throw new Error('no electron in unit tests') } }, shell: {} }`
)
fs.cpSync(path.join(APP, 'src', 'main', 'defaultbrowser.ts'), path.join(tmp, 'defaultbrowser.ts'))
const OUTDIR = path.join(APP, '.test-v176-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })
await build({
  entryPoints: [path.join(tmp, 'defaultbrowser.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(OUTDIR, 'bundle.mjs'),
  logLevel: 'silent'
})
const { looksLikeUs, parseLaunchArgs } = await import(pathToFileURL(path.join(OUTDIR, 'bundle.mjs')).href)

/* ================= 1. looksLikeUs — the handler matcher ================= */
console.log('\n[1] looksLikeUs — is the OS handler THIS Aether?')
{
  const MINE = 'C:\\Program Files\\Aether\\Aether.exe'
  ok(looksLikeUs('C:\\Program Files\\Aether\\Aether.exe', MINE) === true, 'exact same path')
  ok(looksLikeUs('"c:\\program files\\aether\\aether.exe"', MINE) === true, 'quoted + lowercase')
  ok(looksLikeUs('C:/Program Files/Aether/Aether', MINE) === true, 'forward slashes + no .exe')
  ok(looksLikeUs('Aether', MINE) === true, 'bare basename match')
  ok(looksLikeUs('aether.exe', MINE) === true, 'basename with .exe')
  ok(looksLikeUs('C:\\Program Files\\Google\\Chrome\\chrome.exe', MINE) === false, 'chrome ≠ aether')
  ok(looksLikeUs('NotaetherBrowser.exe', MINE) === false, 'substring impostor rejected')
  ok(looksLikeUs('', MINE) === false, 'empty handler (Linux unknown) ≠ default')
  ok(looksLikeUs('Safari', MINE) === false, 'safari ≠ aether')
  // macOS bundle-name style
  ok(looksLikeUs('Aether', '/Applications/Aether.app/Contents/MacOS/Aether') === true, 'macOS bundle name')
}

/* ================= 2. parseLaunchArgs — second-instance argv ================= */
console.log('\n[2] parseLaunchArgs — what the OS hands us on the command line')
{
  eq(parseLaunchArgs(['Aether.exe', 'https://example.com/a?b=1']), { urls: ['https://example.com/a?b=1'], packages: [] }, 'bare URL extracted')
  eq(parseLaunchArgs(['--flag', '/switch', 'https://a.dev', 'https://b.dev']), { urls: ['https://a.dev', 'https://b.dev'], packages: [] }, 'flags skipped, multi-URL')
  eq(parseLaunchArgs(['C:\\Users\\me\\ext.crx']), { urls: [], packages: ['C:\\Users\\me\\ext.crx'] }, 'crx routed to packages')
  eq(parseLaunchArgs(['C:\\Users\\me\\theme.zip']), { urls: [], packages: ['C:\\Users\\me\\theme.zip'] }, 'zip routed to packages')
  eq(parseLaunchArgs([]), { urls: [], packages: [] }, 'empty argv')
  eq(parseLaunchArgs(['just some file.txt']), { urls: [], packages: [] }, 'junk ignored')
  eq(parseLaunchArgs(['https://' + 'x'.repeat(3000)]), { urls: [], packages: [] }, 'pathological URL length-capped')
  const many = parseLaunchArgs(Array.from({ length: 40 }, (_, i) => `https://s${i}.dev`))
  eq(many.urls.length, 16, 'URL count capped at 16')
  eq(parseLaunchArgs(['HTTP://UPPER.CASE/Path']), { urls: ['HTTP://UPPER.CASE/Path'], packages: [] }, 'case-insensitive scheme')
  eq(parseLaunchArgs([undefined, null, '']), { urls: [], packages: [] }, 'nullish args survive')
}

/* ================= 3. settings card wiring ================= */
console.log('\n[3] settings page — default-browser card')
{
  fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(tmp, 'src', 'main', 'store.ts'),
    `import { normalizeAppearance } from './appearance'
     export function mergedSettings() { return { appearance: normalizeAppearance({}) } }`
  )
  fs.writeFileSync(
    path.join(nm, 'index.js'),
    `module.exports = { app: { getVersion: () => '9.9.9' }, nativeTheme: { shouldUseDarkColors: true } }`
  )
  const entry2 = path.join(tmp, 'src', 'main', 'testable-v176.ts')
  fs.writeFileSync(entry2, `export { SETTINGS_HTML } from './pages'`)
  await build({
    entryPoints: [entry2],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(OUTDIR, 'settings.mjs'),
    logLevel: 'silent'
  })
  const { SETTINGS_HTML } = await import(pathToFileURL(path.join(OUTDIR, 'settings.mjs')).href)
  ok(SETTINGS_HTML.includes('id="default-browser-sec"'), 'card section present')
  ok(SETTINGS_HTML.includes('id="db-set"'), 'set-as-default button present')
  ok(SETTINGS_HTML.includes('id="db-open"'), 'open-system-settings button present')
  ok(SETTINGS_HTML.includes('internal.defaultBrowser()'), 'reads state via the bridge')
  ok(SETTINGS_HTML.includes('internal.setDefaultBrowser()'), 'sets default via the bridge')
  ok(SETTINGS_HTML.includes('internal.openSystemSettings()'), 'system-settings fallback wired')
  ok(SETTINGS_HTML.includes('Aether is your default browser'), 'positive state copy')
}

/* ================= 4. OS plumbing wiring ================= */
console.log('\n[4] plumbing — ipc + preload + second-instance + installer')
{
  const ipc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf8')
  ok(ipc.includes("'internal:default-browser'") && ipc.includes("'internal:set-default-browser'"), 'ipc handlers registered')
  const preload = fs.readFileSync(path.join(APP, 'src', 'preload', 'api.ts'), 'utf8')
  ok(preload.includes('internal:default-browser'), 'preload exposes defaultBrowser')
  const idx = fs.readFileSync(path.join(APP, 'src', 'main', 'index.ts'), 'utf8')
  ok(idx.includes('parseLaunchArgs(argv)') && idx.includes('openUrlInRunningBrowser'), 'second-instance opens OS-handed URLs')
  const win = fs.readFileSync(path.join(APP, 'src', 'main', 'windows.ts'), 'utf8')
  ok(win.includes('export function openUrlInRunningBrowser'), 'openUrlInRunningBrowser exported')
  const yml = fs.readFileSync(path.join(APP, 'electron-builder.yml'), 'utf8')
  ok(yml.includes('ext: htm') && yml.includes('ext: html'), 'installer associates .html/.htm')
}

fs.rmSync(OUTDIR, { recursive: true, force: true })

console.log(`\nv1.7.0 build 5 (default browser): ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
