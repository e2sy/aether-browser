/**
 * v1.9.0 build 13 — Phase 3 privacy fortress: query-param scrubber (#58),
 * HTTPS-only (#60), DoH selector (#61), clear-data (#63), referrer
 * tightening (#68).
 *
 * Run:  node scripts/test-v184.mjs
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
  ok(sa === sb, `${name} (got ${sa?.slice(0, 130)}, want ${sb?.slice(0, 130)})`)
}

/* ---------- bundle privacy.ts ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test184-'))
const stage = path.join(tmp, 'privacy')
fs.mkdirSync(stage, { recursive: true })
fs.cpSync(path.join(APP, 'src', 'main', 'privacy.ts'), path.join(stage, 'privacy.ts'))
const nm = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(nm, { recursive: true })
fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }))
fs.writeFileSync(path.join(nm, 'index.js'), `module.exports = { session: { defaultSession: {} }, shell: {} }`)
const OUTDIR = path.join(APP, '.test-v184-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })
await build({ entryPoints: [path.join(stage, 'privacy.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(OUTDIR, 'privacy.mjs'), logLevel: 'silent' })
const pv = await import(pathToFileURL(path.join(OUTDIR, 'privacy.mjs')).href)

console.log('\n── query-param scrubber (#58) ──')
eq(
  pv.stripTrackingParams('https://news.example/article?utm_source=rss&utm_medium=feed&id=42'),
  'https://news.example/article?id=42',
  'utm_* stripped, real params kept'
)
eq(pv.stripTrackingParams('https://x.com/?fbclid=IwAR123'), 'https://x.com/', 'fbclid-only → bare URL, no dangling ?')
eq(pv.stripTrackingParams('https://sho.ps/p?gclid=Cj0K&utm_content=ad&id=7#size'), 'https://sho.ps/p?id=7#size', 'hash preserved')
eq(pv.stripTrackingParams('https://clean.example/page?a=1'), null, 'no trackers → null (no redirect)')
eq(pv.stripTrackingParams('https://UTM_SOURCE=low.example/?Utm_Campaign=x'.replace('https://UTM_SOURCE=low.example', 'https://low.example')), 'https://low.example/', 'param names matched case-insensitively')
eq(pv.stripTrackingParams('file:///etc/passwd?utm_source=x'), null, 'non-http schemes never touched')
eq(pv.stripTrackingParams('https://mail.example/?si=abc123'), 'https://mail.example/', 'shared-link si tracker stripped')
ok(pv.TRACKING_PARAMS.includes('gclid') && pv.TRACKING_PARAMS.length > 30, 'tracker list is substantial')

console.log('\n── HTTPS-only (#60) ──')
const memo = new Set()
eq(pv.httpsUpgradeTarget('http://example.com/a', [], memo), 'https://example.com/a', 'http upgraded')
eq(pv.httpsUpgradeTarget('http://example.com/a', [], memo), null, 'same URL not re-upgraded (no loops on downgrade)')
eq(pv.httpsUpgradeTarget('https://example.com', [], memo), null, 'https untouched')
eq(pv.httpsUpgradeTarget('http://example.com', ['example.com'], new Set()), null, 'exempt host stays on http')
eq(pv.httpsUpgradeTarget('http://localhost:3000/dev', [], new Set()), null, 'localhost never upgraded')
eq(pv.httpsUpgradeTarget('http://192.168.1.10/admin', [], new Set()), null, 'LAN hosts never upgraded')
eq(pv.httpsUpgradeTarget('http://myserver.local/x', [], new Set()), null, '.local never upgraded')
eq(pv.httpsUpgradeTarget('http://10.0.0.5/x', [], new Set()), null, '10.x never upgraded')

console.log('\n── clear-data options (#63) ──')
const NOW = 1_700_000_000_000
ok(pv.historyCutoff('24h', NOW) > 0 && Math.abs(pv.historyCutoff('24h', NOW) - (NOW - 86_400_000)) < 1, '24h cutoff ≈ now-1day')
eq(pv.historyCutoff('all', NOW), 0, 'all-time cutoff = 0 (everything)')
eq(pv.historyCutoff('1h', NOW), NOW - 3600_000, '1h cutoff')
const s1 = pv.storagesFor(['cookies'])
eq(s1, ['cookies'], 'cookies-only → cookies storage')
const s2 = pv.storagesFor(['siteData'])
ok(Array.isArray(s2) && s2.includes('localstorage') && s2.includes('serviceworkers') && !s2.includes('cookies'), 'site-data clears storage types but not cookies')
ok(Array.isArray(pv.storagesFor(['cookies', 'siteData'])) && pv.storagesFor(['cookies', 'siteData']).length === 6, 'both kinds → 6 storage types')
eq(pv.storagesFor(['history']), undefined, 'history-only needs no storage clears')

console.log('\n── referrer tightening (#68) ──')
eq(pv.tightenReferrer('https://news.example/story', 'https://shop.example/item'), 'https://news.example/', 'cross-origin → origin only')
eq(pv.tightenReferrer('https://a.example/x', 'https://a.example/y'), null, 'same-origin untouched')
eq(pv.tightenReferrer('', 'https://a.example'), null, 'no referrer → no change')

console.log('\n── wiring — boot, settings, settings page ──')
const idxSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'index.ts'), 'utf-8')
ok(idxSrc.includes('installPrivacy('), 'boot installs the privacy interceptors')
ok(idxSrc.includes('DnsOverHttps'), 'DoH switches wired pre-ready')
ok(idxSrc.includes('dns-over-https-templates'), 'DoH template switch present')
const typesSrc = fs.readFileSync(path.join(APP, 'src', 'shared', 'types.ts'), 'utf-8')
ok(typesSrc.includes('paramScrubber') && typesSrc.includes('httpsOnly') && typesSrc.includes('dohMode') && typesSrc.includes('referrerTight'), 'all privacy settings typed')
const storeSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'store.ts'), 'utf-8')
ok(storeSrc.includes('paramScrubber: true') && storeSrc.includes('referrerTight: true'), 'scrubber + referrer default ON')
ok(storeSrc.includes('httpsOnly: false'), 'HTTPS-only defaults OFF (opt-in)')
ok(storeSrc.includes("dohMode: 'off'"), 'DoH defaults off')
const pagesSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf-8')
ok(pagesSrc.includes("id=\"paramScrubber\"") && pagesSrc.includes("id=\"httpsOnly\""), 'privacy toggles in settings page')
ok(pagesSrc.includes("id=\"dohMode\"") && pagesSrc.includes("id=\"dohPreset\""), 'DoH selector present')
ok(pagesSrc.includes("id=\"cdGo\"") && pagesSrc.includes('privacy.clearData'), 'clear-data dialog wired')
const ipcSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf-8')
ok(ipcSrc.includes("'privacy:clearData'") && ipcSrc.includes('historyCutoff') && ipcSrc.includes('storagesFor'), 'clear-data IPC uses the pure builders')
const apiSrc = fs.readFileSync(path.join(APP, 'src', 'preload', 'api.ts'), 'utf-8')
ok(apiSrc.includes("invoke('privacy:clearData'"), 'bridge exposes privacy.clearData')
const privSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'privacy.ts'), 'utf-8')
ok(privSrc.includes('resourceType === '), 'scrubber scoped to top-frame navigations only')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(OUTDIR, { recursive: true, force: true })
console.log(`\n═══ test-v184: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
