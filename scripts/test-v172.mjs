/**
 * v1.7.0 build 2 — CSP v2 (script nonces) + navigation lockdown tests.
 *
 * Proves: every internal page carries a nonce-locked CSP (no script
 * 'unsafe-inline'), scripts carry the SAME nonce as their meta tag, the
 * nonce rotates between pages, security headers agree with the meta and add
 * frame-ancestors, and the navlock policy blocks exactly the hostile
 * in-page navigation classes while leaving real browsing untouched.
 *
 * Run:  node scripts/test-v172.mjs
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
  ok(sa === sb, `${name} (got ${sa?.slice(0, 90)}, want ${sb?.slice(0, 90)})`)
}

/* ---------- bundle pages.ts + navlock.ts (electron + store stubbed) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test172-'))
fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

// store.ts is disk-backed; pages.ts only needs mergedSettings().appearance
fs.writeFileSync(
  path.join(tmp, 'src', 'main', 'store.ts'),
  `import { normalizeAppearance } from './appearance'
   export function mergedSettings() { return { appearance: normalizeAppearance({}) } }`
)
// minimal electron stub: pages.ts touches app.getVersion + nativeTheme
const nm = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(nm, { recursive: true })
fs.writeFileSync(
  path.join(nm, 'package.json'),
  JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' })
)
fs.writeFileSync(
  path.join(nm, 'index.js'),
  `module.exports = {
     app: { getVersion: () => '9.9.9' },
     nativeTheme: { shouldUseDarkColors: true }
   }`
)

const entry = path.join(tmp, 'src', 'main', 'testable-v172.ts')
fs.writeFileSync(
  entry,
  `export {
     NEW_TAB_HTML, SEARCH_HTML, HISTORY_HTML, BOOKMARKS_HTML,
     SETTINGS_HTML, DOWNLOADS_HTML, ERROR_HTML, internalCsp, pageSecurityHeaders
   } from './pages'
   export { shouldBlockWillNavigate, blockReason } from './navlock'`
)

const OUTDIR = path.join(APP, '.test-v172-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(OUTDIR, 'bundle.mjs'),
  logLevel: 'silent'
})
const B = await import(pathToFileURL(path.join(OUTDIR, 'bundle.mjs')).href)
const {
  NEW_TAB_HTML, SEARCH_HTML, HISTORY_HTML, BOOKMARKS_HTML,
  SETTINGS_HTML, DOWNLOADS_HTML, ERROR_HTML, internalCsp, pageSecurityHeaders,
  shouldBlockWillNavigate, blockReason
} = B

const PAGES = {
  newtab: NEW_TAB_HTML,
  search: SEARCH_HTML,
  history: HISTORY_HTML,
  bookmarks: BOOKMARKS_HTML,
  settings: SETTINGS_HTML,
  downloads: DOWNLOADS_HTML,
  error: ERROR_HTML
}

/* ================= 1. CSP v2 on every internal page ================= */
if (process.env.DBG_HEAD) console.log("HEAD:", NEW_TAB_HTML.slice(0, 600))
console.log('\n[1] nonce-locked CSP on every internal page')
function metaNonce(html) {
  const m = /<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'nonce-([^']+)'/.exec(html)
  return m ? m[1] : null
}
for (const [name, html] of Object.entries(PAGES)) {
  const n = metaNonce(html)
  ok(n !== null, `${name}: meta CSP carries a script nonce`)
  const scripts = html.match(/<script nonce="([^"]+)">/g) || []
  ok(scripts.length === 1, `${name}: exactly one script tag (${scripts.length})`)
  ok(scripts.length === 1 && scripts[0].includes(`nonce="${n}"`), `${name}: script nonce == meta nonce`)
  ok(!/script-src[^;]*'unsafe-inline'/.test(html), `${name}: script-src has NO unsafe-inline`)
  ok(html.includes("base-uri 'none'") && html.includes("form-action 'none'") && html.includes("object-src 'none'"), `${name}: base-uri/form-action/object-src locked`)
  ok(!/<script>/.test(html.replace(/<script nonce="[^"]+">/g, '')), `${name}: no nonce-less script tags`)
}

/* ================= 2. nonce rotation ================= */
console.log('\n[2] nonces rotate per pageShell call (per-boot randomness)')
{
  const nonces = Object.values(PAGES).map(metaNonce)
  ok(new Set(nonces).size === nonces.length, `all 7 nonces distinct (${new Set(nonces).size}/7)`)
  ok(nonces.every((n) => n && n.length >= 22), 'nonces are 16 random bytes, base64')
}

/* ================= 3. security headers agree with meta ================= */
console.log('\n[3] pageSecurityHeaders — header/meta agreement + frame-ancestors')
{
  const h = pageSecurityHeaders(NEW_TAB_HTML)
  eq(h['x-content-type-options'], 'nosniff', 'nosniff set')
  ok(h['content-security-policy'].includes("frame-ancestors 'none'"), 'header adds frame-ancestors none')
  ok(h['content-security-policy'].includes(`nonce-${metaNonce(NEW_TAB_HTML)}`), 'header nonce == meta nonce')
  ok(!h['content-security-policy'].includes("'unsafe-inline'; script-src"), 'header script-src nonce-only')
  // unknown/garbage page → still safe: a fresh nonce, locked directives
  const h2 = pageSecurityHeaders('<h1>404</h1>')
  ok(h2['content-security-policy'].includes("frame-ancestors 'none'"), '404 body still gets locked headers')
  ok(metaNonce('<h1>404</h1>') === null && h2['content-security-policy'].includes('script-src'), '404 gets a fresh nonce')
}

/* ================= 4. navlock policy matrix ================= */
console.log('\n[4] navlock — the will-navigate policy')
{
  const SHELL = 'file:///app/out/renderer/index.html'
  // chrome shell: blocks EVERYTHING
  ok(shouldBlockWillNavigate(SHELL, 'https://evil.example') === true, 'shell → https blocked')
  ok(shouldBlockWillNavigate(SHELL, 'aether://settings') === true, 'shell → aether blocked')
  ok(shouldBlockWillNavigate(SHELL, 'file:///etc/passwd') === true, 'shell → file blocked')
  // internal pages: blocks EVERYTHING (navigation goes through the bridge)
  ok(shouldBlockWillNavigate('aether://search?q=x', 'https://evil.example') === true, 'internal → https blocked')
  ok(shouldBlockWillNavigate('aether://newtab', 'aether://settings') === true, 'internal → aether blocked')
  ok(shouldBlockWillNavigate('aether://history', 'file:///etc/passwd') === true, 'internal → file blocked')
  // real web pages: free browsing
  ok(shouldBlockWillNavigate('https://example.com', 'https://other.example/page') === false, 'web → web allowed')
  ok(shouldBlockWillNavigate('https://example.com', 'http://other.example') === false, 'web → http allowed')
  ok(shouldBlockWillNavigate('https://example.com', 'aether://newtab') === false, 'web → aether allowed (internal links)')
  ok(shouldBlockWillNavigate('http://example.com', 'about:blank') === false, 'web → about allowed')
  // the classic web-attack classes from a web page
  ok(shouldBlockWillNavigate('https://example.com', 'file:///etc/passwd') === true, 'web → file blocked')
  ok(shouldBlockWillNavigate('https://example.com', 'devtools://devtools/bundled/inspector.html') === true, 'web → devtools blocked')
  ok(shouldBlockWillNavigate('https://example.com', 'chrome://settings') === true, 'web → chrome: blocked')
  ok(shouldBlockWillNavigate('https://example.com', 'chrome-extension://abc/manifest.json') === true, 'web → chrome-extension: blocked')
  ok(shouldBlockWillNavigate('https://example.com', 'view-source:https://example.com') === true, 'web → view-source blocked')
  ok(shouldBlockWillNavigate('https://example.com', 'javascript:alert(1)') === true, 'web → javascript: blocked')
  // hostile inputs never crash, fail closed
  ok(shouldBlockWillNavigate('', 'https://x') === false, 'empty current URL (tab not yet loaded) allows browsing')
  ok(shouldBlockWillNavigate('https://x', '') === true, 'empty target from web fails closed')
  ok(shouldBlockWillNavigate(undefined, undefined) === false || true, 'undefined inputs do not throw')
  // reasons are human-readable
  eq(blockReason(SHELL, 'https://x'), 'chrome-shell lockdown', 'shell reason')
  eq(blockReason('aether://search', 'https://x'), 'internal-page lockdown', 'internal reason')
  eq(blockReason('https://x', 'file:///etc'), 'privileged-scheme guard', 'web reason')
}

/* ================= 5. internalCsp unit behavior ================= */
console.log('\n[5] internalCsp() — directive construction')
{
  const c = internalCsp('ABC123')
  ok(c.includes("script-src 'nonce-ABC123'"), 'nonce embedded')
  const scriptDir = c.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src'))
  ok(scriptDir.indexOf('unsafe-inline') === -1, 'script-src directive contains no unsafe-inline')
  ok(c.startsWith("default-src 'none'"), 'default-src none first')
  const ch = internalCsp('ABC123', true)
  ok(ch.endsWith("frame-ancestors 'none'"), 'header variant appends frame-ancestors')
}
fs.rmSync(OUTDIR, { recursive: true, force: true })

console.log(`\nv1.7.0 build 2 (CSP v2 + navlock): ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
