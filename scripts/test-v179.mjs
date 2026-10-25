/**
 * v1.7.0 build 8 — Phase 1: OS registration + external-protocol dialog.
 * (#22 AppUserModelId/ProgID, #23 LaunchServices, #24 .desktop mimeTypes,
 * #26 external-protocol ask-once, #32 aether:// registration)
 *
 * Run:  node scripts/test-v179.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(ROOT, '..')

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
  ok(sa === sb, `${name} (got ${sa?.slice(0, 110)}, want ${sb?.slice(0, 110)})`)
}

/* ---------- bundle extproto.ts + defaultbrowser.ts (electron stubbed) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test179-'))
const nm = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(nm, { recursive: true })
fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }))
fs.writeFileSync(
  path.join(nm, 'index.js'),
  `module.exports = {
    app: { getPath: () => ${JSON.stringify(path.join(tmp, 'ud'))}, setAsDefaultProtocolClient(){ throw new Error('no electron in unit tests') }, isPackaged: false },
    shell: { openExternal: async () => { throw new Error('no electron in unit tests') } },
    dialog: { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }
  }`
)

async function bundle(srcFile, outName, extra) {
  const stage = path.join(tmp, path.basename(outName, '.mjs'))
  fs.mkdirSync(stage, { recursive: true })
  fs.cpSync(path.join(APP, 'src', 'main', srcFile), path.join(stage, path.basename(srcFile)))
  fs.writeFileSync(
    path.join(stage, 'store.ts'),
    `export class JsonStore { constructor(_n, d) { this.data = d } save() {} }\nexport function mergedSettings() { return {} }\n`
  )
  if (extra) extra(stage)
  const OUTDIR = path.join(APP, `.test-v179-${path.basename(outName, '.mjs')}`)
  fs.rmSync(OUTDIR, { recursive: true, force: true })
  fs.mkdirSync(OUTDIR, { recursive: true })
  await build({
    entryPoints: [path.join(stage, path.basename(srcFile))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(OUTDIR, outName),
    logLevel: 'silent'
  })
  return import(pathToFileURL(path.join(OUTDIR, outName)).href)
}

const ep = await bundle('extproto.ts', 'extproto.mjs')
const db = await bundle('defaultbrowser.ts', 'db.mjs')

console.log('\n── scheme classification (#26) ──')
eq(ep.schemeOf('MAILTO:user@x.com'), 'mailto', 'scheme lowercased')
eq(ep.schemeOf('https://ok.example/x'), 'https', 'web scheme identified')
eq(ep.schemeOf('no-scheme'), '', 'no scheme → empty')
eq(ep.schemeOf(''), '', 'empty → empty')
eq(ep.schemeOf('aether://settings'), 'aether', 'internal scheme identified')

eq(ep.isExternalCandidate('mailto:hi@x.com'), true, 'mailto offered to OS')
eq(ep.isExternalCandidate('magnet:?xt=urn:btih:xyz'), true, 'magnet offered')
eq(ep.isExternalCandidate('ZOOMMTG://zoom.us/j/123'), true, 'uppercase scheme still matches')
eq(ep.isExternalCandidate('https://x.com'), false, 'https is ours, never external')
eq(ep.isExternalCandidate('aether://settings'), false, 'aether is ours, never external')
eq(ep.isExternalCandidate('javascript:alert(1)'), false, 'javascript: is NOT in the hand-off allowlist (fail-closed)')
eq(ep.isExternalCandidate('file:///etc/passwd'), false, 'file: never handed off')
eq(ep.isExternalCandidate('unknownscheme:xyz'), false, 'unknown schemes fail closed')

console.log('\n── canOpenAsTab — second-instance/open-url routing (#32) ──')
eq(ep.canOpenAsTab('https://news.example.com/a?b=c'), true, 'https opens as tab')
eq(ep.canOpenAsTab('HTTP://X.COM'), true, 'case-insensitive http')
eq(ep.canOpenAsTab('aether://settings'), true, 'aether://settings routable')
eq(ep.canOpenAsTab('aether://SEARCH?q=x'), true, 'route check case-insensitive')
eq(ep.canOpenAsTab('aether://newtab'), true, 'aether://newtab routable')
eq(ep.canOpenAsTab('aether://evil'), false, 'aether://evil rejected — only known routes')
eq(ep.canOpenAsTab('aether://../../win'), false, 'path tricks rejected')
eq(ep.canOpenAsTab('aether://'), false, 'empty route rejected')
eq(ep.canOpenAsTab('mailto:a@b.c'), false, 'mailto is NOT a tab')
eq(ep.canOpenAsTab('file:///tmp/x'), false, 'file: never a forwarded tab')
eq(ep.canOpenAsTab(''), false, 'empty never routable')
eq(ep.canOpenAsTab('https://' + 'a'.repeat(5000)), false, 'oversized URL rejected')

console.log('\n── remembered per-scheme choices (#26) ──')
const store = { data: {}, save() {} }
eq(ep.rememberedDecision(store, 'mailto'), 'ask', 'default = ask')
ep.applyRemember(store, 'mailto:user@x', 'allow', true)
eq(ep.rememberedDecision(store, 'mailto'), 'allow', 'remembered allow sticks')
ep.applyRemember(store, 'mailto:user@x', 'block', true)
eq(ep.rememberedDecision(store, 'mailto'), 'block', 're-remember overwrites')
ep.applyRemember(store, 'https://nope', 'allow', true)
eq(Object.keys(store.data).length, 1, 'web schemes never remembered')
ep.applyRemember(store, 'mailto:user@x', 'allow', false)
eq(ep.rememberedDecision(store, 'mailto'), 'block', 'remember=false does not overwrite')

console.log('\n── launch args now carry aether:// links (#32) ──')
eq(db.parseLaunchArgs(['aether://settings']).urls, ['aether://settings'], 'aether:// parsed from argv')
eq(db.parseLaunchArgs(['AETHER://Search']).urls, ['AETHER://Search'], 'scheme matching case-insensitive (stored as-is)')
eq(db.parseLaunchArgs(['https://x.com', 'aether://newtab']).urls.length, 2, 'mixed targets kept')
eq(db.parseLaunchArgs(['--flag', 'aether://settings']).urls, ['aether://settings'], 'flags skipped, urls kept')
eq(db.LINUX_DESKTOP_FILE, 'aether.desktop', 'linux desktop file name pinned')

console.log('\n── wiring — tabs, windows, boot, packaging ──')
const tabsSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'tabs.ts'), 'utf-8')
ok(tabsSrc.includes('isExternalCandidate(targetUrl)') && tabsSrc.indexOf('isExternalCandidate') < tabsSrc.indexOf('shouldBlockWillNavigate(wc.getURL()'), 'external hand-off runs before navlock in will-navigate')
ok(tabsSrc.includes('isExternalCandidate(popupUrl)'), 'window.open hand-off covered too')
const winSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'windows.ts'), 'utf-8')
ok(winSrc.includes('canOpenAsTab(clean)'), 'second-instance forwarding uses the route policy')
const idxSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'index.ts'), 'utf-8')
ok(idxSrc.includes("app.setAppUserModelId('dev.aether.browser')"), 'AppUserModelId matches appId (#22)')
ok(idxSrc.includes("app.on('open-url'"), 'macOS open-url wired (#23)')
ok(idxSrc.includes('openUrlInRunningBrowser(String(url'), 'open-url routes into the running browser')
const dbSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'defaultbrowser.ts'), 'utf-8')
ok(dbSrc.includes("setAsDefaultProtocolClient('aether')"), 'aether:// registered with the OS (#32)')
ok(dbSrc.includes('xdg-settings'), 'linux xdg-settings integration (#24)')
ok(dbSrc.includes('registerAetherScheme()'), 'default-browser flow also claims aether://')
const bldr = fs.readFileSync(path.join(APP, 'electron-builder.yml'), 'utf-8')
ok(bldr.includes('schemes: [http, https]') && bldr.includes('schemes: [aether]'), 'builder registers URL schemes (#23/#32)')
ok(bldr.includes('CFBundleDocumentTypes:'), 'mac LaunchServices document types (#23)')
ok(bldr.includes('LSItemContentTypes: [public.html'), 'mac claims .html documents')
ok(bldr.includes('x-scheme-handler/http') && bldr.includes('application/xhtml+xml'), 'linux desktop mimeTypes (#24)')
const pagesSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf-8')
ok(pagesSrc.includes('extprotoForget'), 'settings page has the reset-choices button')
const apiSrc = fs.readFileSync(path.join(APP, 'src', 'preload', 'api.ts'), 'utf-8')
ok(apiSrc.includes("invoke('extproto:forget')"), 'bridge exposes extproto.forget')
const ipcSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf-8')
ok(ipcSrc.includes("ipcMain.handle('extproto:forget'") && ipcSrc.includes("ipcMain.handle('extproto:list'"), 'ipc handles extproto list/forget')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
for (const d of fs.readdirSync(APP)) {
  if (d.startsWith('.test-v179-')) fs.rmSync(path.join(APP, d), { recursive: true, force: true })
}
console.log(`\n═══ test-v179: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
