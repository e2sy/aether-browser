/**
 * v1.1.5 unit tests — IPC trust policy (the guard that locked the chrome UI
 * out of its own browser).
 *
 * Regression: the multi-window refactor dropped the isChrome() check and kept
 * only "sender URL starts with aether://". The chrome UI runs on the Vite dev
 * server in dev (http://localhost:5173/) and on file:// in production, so
 * EVERY call from the browser's own UI was rejected:
 *   "Unauthorized IPC call to omnibox:suggest from http://localhost:5173/"
 * — dead address bar, dead tab strip, dead toolbar. The policy now trusts the
 * chrome-UI webContents by IDENTITY (sender === entry.win.webContents) plus
 * the aether:// internal pages, and nothing else.
 *
 * Run:  node scripts/test-v115.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const ROOT = path.dirname(new URL(import.meta.url).pathname)
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

/* ---------- build a runnable bundle (trust.ts is pure — no electron) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test115-'))
fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'src', 'main'), { recursive: true })

fs.copyFileSync(path.join(APP, 'src', 'main', 'trust.ts'), path.join(tmp, 'src', 'main', 'trust.ts'))
const entry = path.join(tmp, 'src', 'testable.ts')
fs.writeFileSync(entry, `export { ipcGuardDecision, isAetherInternalSender } from './main/trust'`)

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(tmp, 'bundle.mjs'),
  logLevel: 'silent'
})

const B = await import(pathToFileURL(path.join(tmp, 'bundle.mjs')).href)
const { ipcGuardDecision, isAetherInternalSender } = B

/* ---------- 1. chrome-UI identity: trusted regardless of URL ---------- */
// Identity is established in ipc.ts (sender === entry.win.webContents); the
// decision must accept it for every URL the UI legitimately has.
ok(ipcGuardDecision('http://localhost:5173/', true) === true, 'dev Vite UI (localhost:5173) trusted by identity')
ok(ipcGuardDecision('http://127.0.0.1:5173/', true) === true, 'dev Vite UI (127.0.0.1) trusted by identity')
ok(ipcGuardDecision('http://localhost:4173/', true) === true, 'preview-server UI trusted by identity')
ok(ipcGuardDecision('file:///app/out/renderer/index.html', true) === true, 'prod file:// UI trusted by identity')
ok(ipcGuardDecision(null, true) === true, 'UI with null URL (not yet navigated) trusted by identity')
ok(ipcGuardDecision('data:text/html,boot', true) === true, 'UI mid-boot (data URL) trusted by identity')
ok(ipcGuardDecision(undefined, true) === true, 'UI with undefined URL trusted by identity')

/* ---------- 2. aether:// internal pages: trusted without identity ---------- */
ok(ipcGuardDecision('aether://newtab', false) === true, 'aether://newtab trusted')
ok(ipcGuardDecision('aether://search?q=nodejs', false) === true, 'aether://search trusted')
ok(ipcGuardDecision('aether://settings', false) === true, 'aether://settings trusted')
ok(ipcGuardDecision('aether://history', false) === true, 'aether://history trusted')
ok(ipcGuardDecision('aether://bookmarks', false) === true, 'aether://bookmarks trusted')

/* ---------- 3. everything else: rejected ---------- */
// The exact regression: dev URL is NOT enough on its own — a tab (or an
// attacker page) pointing at the dev server must never gain trust by URL.
ok(ipcGuardDecision('http://localhost:5173/', false) === false, 'dev Vite URL WITHOUT identity rejected')
ok(ipcGuardDecision('file:///app/out/renderer/index.html', false) === false, 'prod file:// URL WITHOUT identity rejected')
ok(ipcGuardDecision('https://example.com/page', false) === false, 'https page rejected')
ok(ipcGuardDecision('http://evil.example.com', false) === false, 'http page rejected')
ok(ipcGuardDecision('file:///C:/Users/x/evil.html', false) === false, 'local file:// page rejected')
ok(ipcGuardDecision('chrome-extension://abcdef/popup.html', false) === false, 'chrome-extension page rejected')
ok(ipcGuardDecision('about:blank', false) === false, 'about:blank rejected')
ok(ipcGuardDecision('', false) === false, 'empty URL rejected')
ok(ipcGuardDecision(null, false) === false, 'null URL rejected')
ok(ipcGuardDecision(undefined, false) === false, 'undefined URL rejected')

/* ---------- 4. strict internal:* rule (aether:// pages only) ---------- */
ok(isAetherInternalSender('aether://search?q=x') === true, 'isAetherInternalSender allows aether://')
ok(isAetherInternalSender('http://localhost:5173/') === false, 'isAetherInternalSender still blocks the UI')
ok(isAetherInternalSender('https://example.com') === false, 'isAetherInternalSender blocks https pages')
ok(isAetherInternalSender(null) === false, 'isAetherInternalSender blocks null URL')
ok(isAetherInternalSender('AETHER://newtab') === false, 'isAetherInternalSender is scheme-case strict (getURL normalizes)')

/* ---------- 5. sanity: internal:* rule agrees with the main decision ---------- */
ok(ipcGuardDecision('aether://settings', false) === isAetherInternalSender('aether://settings'),
  'decision and strict rule agree on aether:// senders')

console.log(`\nv1.1.5 trust-policy tests: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
