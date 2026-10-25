/**
 * v1.7.0 build 9 — Phase 1 OS chrome: tray (#28), jump list / dock menu /
 * taskbar progress (#27), native notifications (#30), badges (#31),
 * startup boost (#29).
 *
 * Exercises osshell.ts pure helpers and asserts all the wiring.
 *
 * Run:  node scripts/test-v180.mjs
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

/* ---------- bundle osshell.ts (electron + local deps stubbed) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test180-'))
const nm = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(nm, { recursive: true })
fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }))
fs.writeFileSync(
  path.join(nm, 'index.js'),
  `module.exports = {
    app: { getPath: () => ${JSON.stringify(path.join(tmp, 'ud'))}, getJumpListSettings: () => ({ minItems: 10 }), setJumpList(){ throw new Error('no electron in unit tests') }, dock: undefined, isPackaged: true },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
    Notification: { isSupported: () => false },
    Tray: function () { throw new Error('no electron in unit tests') },
    nativeImage: { createFromPath: () => ({}), createFromBuffer: () => ({}) },
    BrowserWindow: { getAllWindows: () => [] }
  }`
)

const stage = path.join(tmp, 'osshell')
fs.mkdirSync(stage, { recursive: true })
fs.cpSync(path.join(APP, 'src', 'main', 'osshell.ts'), path.join(stage, 'osshell.ts'))
fs.writeFileSync(
  path.join(stage, 'store.ts'),
  `export class JsonStore { constructor(_n, d) { this.data = d } save() {} }\nexport function mergedSettings() { return {} }\n`
)
fs.writeFileSync(path.join(stage, 'adblock.ts'), `export async function applyAdblockSetting(_v) {}\n`)
fs.writeFileSync(
  path.join(stage, 'windows.ts'),
  `export function focusedEntry() { return undefined }\nexport function createBrowserWindow() { throw new Error('no electron in unit tests') }\nexport function focusAnyWindow() { throw new Error('no electron in unit tests') }\nexport function allEntries() { return [] }\n`
)
const OUTDIR = path.join(APP, '.test-v180-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })
await build({
  entryPoints: [path.join(stage, 'osshell.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(OUTDIR, 'osshell.mjs'),
  logLevel: 'silent'
})
const os_ = await import(pathToFileURL(path.join(OUTDIR, 'osshell.mjs')).href)

console.log('\n── badge text (#31) ──')
eq(os_.badgeCountText(0), '', 'zero hides the badge')
eq(os_.badgeCountText(3), '3', 'small counts shown')
eq(os_.badgeCountText(999), '999', '999 boundary')
eq(os_.badgeCountText(1000), '999+', '1000 pins at 999+')
eq(os_.badgeCountText(-5), '', 'negative clamps to hidden')
eq(os_.badgeCountText('7'), '7', 'numeric strings coerced')
eq(os_.badgeCountText(NaN), '', 'NaN fails safe')

console.log('\n── taskbar progress mapping (#27) ──')
eq(os_.progressValue(0, 100), 0, 'zero bytes → 0')
eq(os_.progressValue(50, 100), 0.5, 'half → 0.5')
eq(os_.progressValue(500, 100), 1, 'over-fetch clamps to 1')
eq(os_.progressValue(10, 0), os_.PROGRESS_INDETERMINATE, 'unknown total → indeterminate')
eq(os_.progressValue(10, -5), os_.PROGRESS_INDETERMINATE, 'negative total → indeterminate')
eq(os_.progressValue(0, 0, true), os_.PROGRESS_CLEAR, 'done → clear progress')

console.log('\n── close-to-tray decision (#28) ──')
eq(os_.shouldHideToTray(true, false), true, 'enabled + not quitting → hide')
eq(os_.shouldHideToTray(true, true), false, 'enabled + quitting → real close')
eq(os_.shouldHideToTray(false, false), false, 'disabled → real close')
eq(os_.shouldHideToTray(false, true), false, 'disabled + quitting → real close')

console.log('\n── startup boost login item (#29) ──')
eq(os_.loginItemFor('win32', true), { openAtLogin: true, args: ['--hidden'] }, 'win login item hidden-boot')
eq(os_.loginItemFor('darwin', true), { openAtLogin: true, args: ['--hidden'] }, 'mac login item hidden-boot')
eq(os_.loginItemFor('linux', false), { openAtLogin: false, args: [] }, 'disabled clears it')
eq(os_.launchedHidden(['--hidden']), true, '--hidden detected at boot')
eq(os_.launchedHidden(['--new-window']), false, 'other flags ignored')
eq(os_.launchedHidden([]), false, 'empty argv is a normal boot')

console.log('\n── jump list + dock menu shapes (#27) ──')
const jl = os_.jumplistEntries()
eq(jl.map((x) => x.label), ['New window', 'New private window', 'Downloads'], 'jump list actions')
ok(jl.every((x) => x.program === process.execPath && typeof x.args === 'string'), 'every entry targets our executable')
eq(os_.dockMenuEntries(), ['New Window', 'New Private Window', 'Downloads'], 'dock menu actions')

console.log('\n── wiring — downloads, windows, boot, settings ──')
const dlSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'downloads.ts'), 'utf-8')
ok(dlSrc.includes('setProgressBar(progressValue('), 'taskbar progress wired to download updates')
ok(dlSrc.includes('setBadgeCount(active.size)'), 'active-download badge wired')
ok(dlSrc.includes("notify('Download complete'"), 'download-complete notification wired')
ok(dlSrc.includes('notifyDownloads !== false'), 'notification respects the setting')
const winSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'windows.ts'), 'utf-8')
ok(winSrc.includes('shouldHideToTray'), 'close-to-tray intercept wired')
ok(winSrc.includes('isBootHidden()'), 'boot-hidden skips auto-show (#29)')
ok(winSrc.includes('wakeFromBootHidden()'), 'focus/link forwarding wakes hidden windows')
const idxSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'index.ts'), 'utf-8')
ok(idxSrc.includes('installOsShell()'), 'boot installs jump list + dock menu')
ok(idxSrc.includes('createTray()'), 'boot creates the tray per setting')
ok(idxSrc.includes('applyStartupBoost('), 'boot applies the login item')
ok(idxSrc.includes('markQuitting()'), 'before-quit marks quitting (close-to-tray escape)')
ok(idxSrc.includes("'--new-window'") && idxSrc.includes("'--private'"), 'jump-list flags open windows via second-instance')
const ipcSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf-8')
ok(ipcSrc.includes('destroyTray()') && ipcSrc.includes('createTray()'), 'tray reacts live to settings:set')
const typesSrc = fs.readFileSync(path.join(APP, 'src', 'shared', 'types.ts'), 'utf-8')
ok(typesSrc.includes('showTray') && typesSrc.includes('closeToTray') && typesSrc.includes('startupBoost') && typesSrc.includes('notifyDownloads'), 'all four OS settings typed')
const storeSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'store.ts'), 'utf-8')
ok(storeSrc.includes('closeToTray: false') && storeSrc.includes('startupBoost: false'), 'defaults are conservative')
const pagesSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf-8')
ok(pagesSrc.includes("id=\"showTray\"") && pagesSrc.includes("id=\"closeToTray\"") && pagesSrc.includes("id=\"startupBoost\"") && pagesSrc.includes("id=\"notifyDownloads\""), 'settings page exposes the OS-integration toggles')
const crxSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'crx.ts'), 'utf-8')
ok(crxSrc.includes("notify('Extension installed'"), 'extension install uses a native notification')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(OUTDIR, { recursive: true, force: true })
console.log(`\n═══ test-v180: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
