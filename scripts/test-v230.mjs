/**
 * v2.3.0 build 17 — real-browser power features:
 *   1. Tab search (Ctrl+Shift+A, Chrome parity)  — src/shared/tabsearch.ts
 *   2. Password manager (OS-keychain vault)      — src/shared/creds.ts
 *   3. PWA "Install as app"                      — src/shared/pwa.ts
 * plus static wiring gates so a refactor can never silently unhook a flow.
 *
 * Run:  node scripts/test-v230.mjs
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
  ok(sa === sb, `${name} (got ${sa?.slice(0, 140)}, want ${sb?.slice(0, 140)})`)
}
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8')

/* ---------- esbuild-bundle the pure modules ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test230-'))
const OUTDIR = path.join(APP, '.test-v230-build')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })
async function bundle(relSrc, outName) {
  await build({
    entryPoints: [path.join(APP, 'src', relSrc)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(OUTDIR, outName),
    logLevel: 'silent'
  })
  return import(pathToFileURL(path.join(OUTDIR, outName)).href)
}
const tabsearch = await bundle('shared/tabsearch.ts', 'tabsearch.mjs')
const creds = await bundle('shared/creds.ts', 'creds.mjs')
const pwa = await bundle('shared/pwa.ts', 'pwa.mjs')

/* ================================================================
 * [1] TAB SEARCH
 * ================================================================ */
console.log('\n[1] tab search (shared/tabsearch.ts)')
const T = (id, title, url, extra = {}) => ({ id, title, url, favicon: null, loading: false, canGoBack: false, canGoForward: false, pinned: false, muted: false, audible: false, discarded: false, hibernated: false, ...extra })
const TABS = [
  T(1, 'GitHub — Pull requests', 'https://github.com/e2sy/aether-browser/pulls'),
  T(2, 'YouTube', 'https://www.youtube.com/watch?v=abc'),
  T(3, 'Docs — Electron', 'https://electronjs.org/docs/latest'),
  T(4, 'YouTube Music', 'https://music.youtube.com/', { audible: true })
]

eq(tabsearch.hostOfTab('https://www.YouTube.com/watch?v=1'), 'youtube.com', 'hostOfTab strips www + lowercases')
eq(tabsearch.hostOfTab('not a url'), '', 'hostOfTab garbage → empty string')

// empty query: strip order, active first
const empty = tabsearch.rankTabs('', TABS, 3)
eq(empty.map((h) => h.tab.id), [3, 1, 2, 4], 'empty query lists every tab, active first')

// title fuzzy hit wins
const yt = tabsearch.rankTabs('youtube', TABS, null)
ok(yt.length >= 2, 'query "youtube" finds both YouTube tabs')
ok(yt[0].tab.id === 2, 'title hit (plain YouTube) outranks the URL-only music tab')

// host boost: typing "electron" ranks the host match first even when "docs" also matches
const el = tabsearch.rankTabs('electron', TABS, null)
ok(el.length > 0 && el[0].tab.id === 3, 'host match (electronjs.org) wins')

// non-matches are dropped, limit respected
eq(tabsearch.rankTabs('zzznomatch', TABS).length, 0, 'non-matching query returns nothing')
const many = Array.from({ length: 40 }, (_, i) => T(i + 10, `Tab ${i}`, `https://site${i}.com`))
ok(tabsearch.rankTabs('', many, null, 24).length === 24, 'limit caps the empty-query list')

// pinned + active tiebreaks
const tie = [T(1, 'tab one', 'https://a.com'), T(2, 'tab one twin', 'https://b.com', { pinned: true })]
eq(tabsearch.rankTabs('one', tie)[0].tab.id, 2, 'pinned tab wins score ties')
eq(tabsearch.rankTabs('one', tie, 1)[0].tab.id, 1, 'active tab beats pinned on ties (+2 vs +1)')

/* ================================================================
 * [2] PASSWORD VAULT (pure halves)
 * ================================================================ */
console.log('\n[2] password manager (shared/creds.ts)')

// hosts
eq(creds.normalizeHost('https://WWW.Example.com/login?x=1'), 'example.com', 'normalizeHost: www + case + path gone')
eq(creds.normalizeHost('http://accounts.example.com'), 'accounts.example.com', 'normalizeHost: subdomains stay distinct')
eq(creds.normalizeHost('garbage'), '', 'normalizeHost: garbage → ""')

// strength
eq(creds.passwordStrength('').score, 0, 'strength: empty → 0')
eq(creds.passwordStrength('password').score, 1, 'strength: 8 chars single class → 1')
eq(creds.passwordStrength('Password123').score, 2, 'strength: 11 chars 3 classes → fair (len<12)')
ok(creds.passwordStrength('Str0ng!Passw0rd!!').score >= 3, 'strength: long mixed → strong/excellent')
eq(creds.passwordStrength('abcdefghijklmnopqrst').score, 3, 'strength: 20-char passphrase (single class) earns strong')
eq(creds.passwordStrength('aaaaaaaaaaaaaaaaaaaa').score, 1, 'strength: 20 repeated chars stays weak (no entropy)')
ok(creds.passwordStrength('Ab1!').score < creds.passwordStrength('Ab1!Ab1!Ab1!Ab1!').score, 'strength: longer is never weaker')

// generator (deterministic rng)
let seed = 42
const rng = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const gen = creds.generatePassword(20, rng)
eq(gen.length, 20, 'generatePassword: exact length')
ok(/[a-z]/.test(gen) && /[A-Z]/.test(gen) && /[0-9]/.test(gen) && /[^A-Za-z0-9]/.test(gen), 'generatePassword: every class present')
ok(!/[lI10O'`"]/.test(gen), 'generatePassword: ambiguous glyphs excluded')
eq(creds.generatePassword(3, rng).length, 8, 'generatePassword: clamped up to min 8')
eq(creds.generatePassword(500, rng).length, 96, 'generatePassword: clamped down to max 96')
ok(creds.generatePassword(20, Math.random) !== creds.generatePassword(20, Math.random), 'generatePassword: random mode produces different values')

// field picking
eq(creds.pickLoginFields([{ type: 'email', hint: 'email' }, { type: 'password' }]), { passwordIdx: 1, usernameIdx: 0 }, 'pickLoginFields: email + password')
eq(creds.pickLoginFields([{ type: 'text', hint: 'search the site' }, { type: 'text', hint: 'username' }, { type: 'password' }]), { passwordIdx: 2, usernameIdx: 1 }, 'pickLoginFields: search boxes are skipped')
eq(creds.pickLoginFields([{ type: 'text' }, { type: 'checkbox' }]), { passwordIdx: -1, usernameIdx: -1 }, 'pickLoginFields: no password → -1/-1')
eq(creds.pickLoginFields([{ type: 'password' }, { type: 'password' }]), { passwordIdx: 0, usernameIdx: -1 }, 'pickLoginFields: first password wins, no username')

// sanitizers
eq(creds.sanitizeUsername('  bob\x00\x1fsmith  '), 'bob smith', 'sanitizeUsername: controls → space, trimmed')
ok(creds.sanitizePassword('p\x01w').length === 2 && creds.sanitizePassword('p\x01w') === 'pw', 'sanitizePassword: controls stripped')
eq(creds.sanitizeUsername('x'.repeat(500)).length, 128, 'sanitizeUsername: clamped to 128')
eq(creds.sanitizePassword('x'.repeat(500)).length, 256, 'sanitizePassword: clamped to 256')

// matching
const RECS = [
  { id: 'a', host: 'example.com', username: 'old@x.com', enc: 'A', ts: 100, strong: 2 },
  { id: 'b', host: 'example.com', username: 'new@x.com', enc: 'B', ts: 900, strong: 4 },
  { id: 'c', host: 'other.com', username: 'z', enc: 'C', ts: 999, strong: 4 }
]
eq(creds.matchCreds(RECS, 'https://www.example.com/login').id, 'b', 'matchCreds: www-equivalent host, newest wins')
eq(creds.matchCreds(RECS, 'https://example.com').id, 'b', 'matchCreds: bare host matches')
eq(creds.matchCreds(RECS, 'https://accounts.example.com'), null, 'matchCreds: subdomain does NOT match (anti-phishing)')
eq(creds.matchCreds([], 'https://example.com'), null, 'matchCreds: empty vault → null')
eq(creds.matchCreds(RECS, 'nonsense'), null, 'matchCreds: bad URL → null')

// injection-safe script builders
const EVIL_U = '"><img src=x onerror=alert(1)>\\';;
const EVIL_P = '</script><script>alert(2)</script>'
const fill = creds.buildFillScript(EVIL_U, EVIL_P)
ok(fill.includes(JSON.stringify(EVIL_U)), 'fillScript: evil username embedded via JSON.stringify (escaped)')
ok(fill.includes(JSON.stringify(EVIL_P)), 'fillScript: evil password embedded via JSON.stringify (escaped)')
ok(fill.includes('set(ui >= 0 ? inputs[ui] : null'), 'fillScript: username targets the runtime-detected field')
ok(fill.includes("new Event('input', { bubbles: true })"), 'fillScript: fires input events (SPA frameworks pick it up)')
ok(fill.includes('HTMLInputElement.prototype'), 'fillScript: React-compatible native value setter')
ok(creds.buildGenerateScript('Ab1!x').includes(JSON.stringify('Ab1!x')), 'generateScript: value JSON-embedded')
ok(creds.SUBMIT_HOOK_SCRIPT.includes('__aetherCredHook'), 'submit hook: idempotence flag present')
ok(creds.SUBMIT_HOOK_SCRIPT.includes("addEventListener('submit'"), 'submit hook: listens on submit (capture phase)')
ok(creds.PROBE_SCRIPT.includes("getAttribute('type')"), 'probe script: scans password inputs')

/* ================================================================
 * [3] PWA / WEB APPS
 * ================================================================ */
console.log('\n[3] web apps (shared/pwa.ts)')

eq(pwa.parseManifestLink('<link rel="manifest" href="/app.webmanifest">'), '/app.webmanifest', 'manifest link: basic')
eq(pwa.parseManifestLink("<LINK REL='manifest' HREF='/m.json'>"), '/m.json', 'manifest link: case + single quotes')
eq(pwa.parseManifestLink('<link rel="icon" href="/x.png"><link rel="manifest" href="/m.webmanifest">'), '/m.webmanifest', 'manifest link: skips icon links')
eq(pwa.parseManifestLink('<html><body>no manifest</body></html>'), null, 'manifest link: absent → null')
eq(pwa.parseManifestLink('<link rel="preload" as="manifest" href="fake">'), null, 'manifest link: rel must be exactly manifest')

eq(pwa.resolveUrl('https://app.example.com/a/b/m.webmanifest', 'start.html'), 'https://app.example.com/a/b/start.html', 'resolveUrl: relative against manifest dir')
eq(pwa.resolveUrl('https://x.com/', 'https://y.com/z'), 'https://y.com/z', 'resolveUrl: absolute wins')
eq(pwa.resolveUrl('https://x.com/', 'javascript:alert(1)'), 'javascript:alert(1)', 'resolveUrl: passes through (caller enforces http(s))')

const MANI = JSON.stringify({
  name: 'Excalidraw',
  short_name: 'Excali',
  start_url: '/drawing',
  display: 'standalone',
  icons: [
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-mask-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
})
const pm = pwa.parseManifestJson(MANI, 'https://excalidraw.com/manifest.json')
eq(pm?.name, 'Excalidraw', 'manifest: name parsed')
eq(pm?.shortName, 'Excali', 'manifest: short_name parsed')
eq(pm?.startUrl, 'https://excalidraw.com/drawing', 'manifest: start_url resolved against manifest URL')
eq(pm?.icons.length, 4, 'manifest: icons kept')

const best = pwa.pickIcon(pm.icons)
eq(best?.src, '/icon-512.png', 'pickIcon: biggest raster beats svg + maskable twin')
eq(pwa.parseManifestJson('{not json', 'https://x.com/m.json'), null, 'manifest: invalid JSON → null')
eq(pwa.parseManifestJson('[1,2]', 'https://x.com/m.json'), null, 'manifest: arrays rejected')
eq(pwa.parseManifestJson('{"name":"X","start_url":"file:///etc"}', 'https://x.com/m.json'), null, 'manifest: non-http start_url rejected')
eq(pwa.parseManifestJson('{"name":"X","start_url":"/a"}', 'https://x.com/m.json')?.startUrl, 'https://x.com/a', 'manifest: http start_url kept')
eq(pwa.parseManifestJson('{"short_name":"S","start_url":"."}', 'https://x.com/m.json')?.name, '', 'manifest: missing name → empty (caller falls back to host)')

eq(pwa.parseIconSizes('192x192 512x512'), [192, 512], 'sizes: multi-value')
eq(pwa.parseIconSizes('any'), [], 'sizes: "any" → []')
eq(pwa.parseIconSizes('garbage'), [], 'sizes: garbage → []')

ok(pwa.pickIcon([]) === null, 'pickIcon: empty → null')
eq(pwa.pickIcon([{ src: 'a.png' }, { src: 'b.svg' }])?.src, 'a.png', 'pickIcon: unknown sizes → raster still preferred over svg')

eq(pwa.slugAppId('https://app.slack.com/client/T01'), 'app.slack.com-client-t01', 'slugAppId: host + path slug (only www. is stripped)')
eq(pwa.slugAppId('https://Excalidraw.COM/'), 'excalidraw.com', 'slugAppId: bare host, lowercased')
eq(pwa.slugAppId('https://x.com/a/B?c=1'), 'x.com-a-b', 'slugAppId: query dropped, case folded')
eq(pwa.slugAppId('nonsense'), 'app', 'slugAppId: garbage → "app"')
eq(pwa.parseAppArg(['electron', '--aether-app=slack.com-client']), 'slack.com-client', 'parseAppArg: found')
eq(pwa.parseAppArg(['--aether-app=;rm -rf']), null, 'parseAppArg: hostile value rejected')
eq(pwa.parseAppArg([]), null, 'parseAppArg: no arg → null')
eq(pwa.parseAppArg(undefined), null, 'parseAppArg: undefined argv → null')

/* ================================================================
 * [4] STATIC WIRING GATES
 * ================================================================ */
console.log('\n[4] static wiring gates')

const apiSrc = read('src/preload/api.ts')
ok(apiSrc.includes("invoke('creds:list'"), 'bridge exposes creds.list')
ok(apiSrc.includes("invoke('creds:reveal'"), 'bridge exposes creds.reveal')
ok(apiSrc.includes("subscribe('creds:prompt')"), 'bridge subscribes to creds:prompt')
ok(apiSrc.includes("invoke('apps:install'"), 'bridge exposes apps.install')
ok(apiSrc.includes("subscribe('tabsearch:show')"), 'bridge subscribes to tabsearch:show')

const ipcSrc = read('src/main/ipc.ts')
for (const ch of ['creds:list', 'creds:reveal', 'creds:add', 'creds:remove', 'creds:block', 'creds:unblock', 'creds:respond', 'creds:submit', 'apps:list', 'apps:install', 'apps:launch', 'apps:remove']) {
  ok(ipcSrc.includes(`ipcMain.handle('${ch}'`), `ipc registers ${ch}`)
}
// creds:submit is the ONLY page-allowed channel — it must not sit behind the standard guard
ok(!/ipcMain\.handle\('creds:submit'[\s\S]{0,600}?guard\(e, 'creds:submit'\)/.test(ipcSrc), 'creds:submit deliberately outside the standard guard')
ok(ipcSrc.includes('isPrivateView(wcId)'), 'creds:submit checks the private-view registry')

const menuSrc = read('src/main/menu.ts')
ok(menuSrc.includes("accelerator: 'CmdOrCtrl+Shift+A'") && menuSrc.includes('Search Tabs…'), 'menu: Search Tabs… on Ctrl+Shift+A')
ok(menuSrc.includes("accelerator: 'CmdOrCtrl+E'"), 'menu: AI sidebar moved to Ctrl+E')
ok(menuSrc.includes('aether://passwords'), 'menu: Password Manager item')
ok(menuSrc.includes('saveLoginFromContext') && menuSrc.includes('fillLoginFor') && menuSrc.includes('generateAndFill'), 'menu: password context-menu actions wired')
ok(menuSrc.includes('installFromTab') && menuSrc.includes('appForHost'), 'menu: install/open web-app context items')

const tabsSrc = read('src/main/tabs.ts')
ok(tabsSrc.includes('wireCredCapture(wc') && tabsSrc.includes('noteCredContext(wc.id'), 'tabs: capture wired per view (private flag registered)')

const idxSrc = read('src/main/index.ts')
ok(idxSrc.includes('passwords: PASSWORDS_HTML'), 'index: aether://passwords route registered')
ok(idxSrc.includes('consumeAppArg(process.argv)') && idxSrc.includes('refreshOSSurfaces()'), 'index: web-app cold start + OS surfaces at boot')
ok(idxSrc.includes('consumeAppArg(argv)'), 'index: second-instance app launches handled')

const pagesSrc = read('src/main/pages.ts')
ok(pagesSrc.includes('export const PASSWORDS_HTML'), 'pages: password manager page exists')
ok(pagesSrc.includes("id: 'appsList'") || pagesSrc.includes("'appsList'"), 'pages: settings web-apps card')
ok(pagesSrc.includes("'pmEnabled'"), 'pages: settings password-manager toggle')

const appSrc = read('src/renderer/src/App.tsx')
ok(appSrc.includes('<TabSearch />') && appSrc.includes('<SaveCredBar />'), 'App mounts TabSearch + SaveCredBar')

const toolbarSrc = read('src/renderer/src/components/Toolbar.tsx')
ok(!/ctrlKey[\s\S]{0,80}shiftKey[\s\S]{0,80}'a'/.test(toolbarSrc), 'Toolbar no longer double-handles Ctrl+Shift+A (TabSearch owns it)')
ok(toolbarSrc.includes("'e'") && toolbarSrc.includes('AI sidebar (Ctrl+E)'), 'Toolbar: sidebar rebound to Ctrl+E')

const tsx = read('src/renderer/src/components/TabSearch.tsx')
ok(tsx.includes("toLowerCase() === 'a'") && tsx.includes('e.shiftKey'), 'TabSearch: capture-phase Ctrl+Shift+A handler')

const storeSrc = read('src/renderer/src/state/store.ts')
ok(storeSrc.includes('tabSearchOpen') && storeSrc.includes('credPrompt'), 'renderer store: new overlay + prompt state')

const credBar = read('src/renderer/src/components/SaveCredBar.tsx')
ok(credBar.includes("respond(prompt.requestId, save, never, username)"), 'SaveCredBar: edited username rides to main')

const css = read('src/renderer/src/styles.css')
ok(css.includes('.cred-bar') && css.includes('.ts-overlay'), 'styles: cred bar + tab search overlay classes')

// settings type + defaults
const typesSrc = read('src/shared/types.ts')
ok(typesSrc.includes('passwordManager: boolean'), 'types: passwordManager setting exists')
const storeTs = read('src/main/store.ts')
ok(storeTs.includes('passwordManager: true'), 'store: passwordManager defaults on')

/* ---------- result ---------- */
console.log(`\n===== v2.3.0: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
