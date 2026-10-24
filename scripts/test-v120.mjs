/**
 * v1.2.0 unit tests — Aether Shields core (the Brave-style blocking upgrade).
 *
 * The old adblocker only cancelled EasyList matches: no cosmetic filtering,
 * no scriptlets, no per-site control, no counters. The shields pipeline now
 * gates EVERYTHING through the pure policy in src/main/shields-core.ts —
 * these tests lock that policy down.
 *
 * Run:  node scripts/test-v120.mjs
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

/* ---------- build a runnable bundle (shields-core.ts is pure — no electron) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test120-'))
fs.mkdirSync(path.join(tmp, 'src', 'main'), { recursive: true })
fs.copyFileSync(path.join(APP, 'src', 'main', 'shields-core.ts'), path.join(tmp, 'src', 'main', 'shields-core.ts'))
const entry = path.join(tmp, 'src', 'testable.ts')
fs.writeFileSync(
  entry,
  `export {
    normalizeHost, hostFromUrl, siteKeyFor, shouldShieldFor, canToggleSiteFor,
    recordBlocked, pruneHosts, MAX_TRACKED_HOSTS, resolveListUrls, mergeCosmetics,
    FILTER_PRESETS, EMPTY_COSMETICS
  } from './main/shields-core'`
)

execSync(
  `${APP}/node_modules/.bin/esbuild ${entry} --bundle --platform=node --format=esm --outfile=${tmp}/bundle.mjs`,
  { stdio: 'pipe' }
)

const B = await import(path.join(tmp, 'bundle.mjs'))
const {
  normalizeHost, hostFromUrl, siteKeyFor, shouldShieldFor, canToggleSiteFor,
  recordBlocked, pruneHosts, MAX_TRACKED_HOSTS, resolveListUrls, mergeCosmetics,
  FILTER_PRESETS, EMPTY_COSMETICS
} = B

/* ---------- 1. host normalization (the per-site key) ---------- */
ok(normalizeHost('WWW.Example.COM.') === 'example.com', 'host normalized: lowercase, no trailing dot, www stripped')
ok(normalizeHost('www.youtube.com') === 'youtube.com', 'www.youtube.com and youtube.com are the same shield site')
ok(normalizeHost('') === '' && normalizeHost(null) === '', 'empty/null host normalizes to empty string')
ok(hostFromUrl('https://www.youtube.com/watch?v=x') === 'youtube.com', 'hostFromUrl handles real video URLs')
ok(hostFromUrl('http://DIFFERENT.example.co.uk:8080/path') === 'different.example.co.uk', 'hostFromUrl strips port + case (full hostname is the site key)')
ok(hostFromUrl('data:text/html,<b>x</b>') === '', 'data: URLs have no host')
ok(hostFromUrl('aether://newtab') === 'newtab', 'aether pages report their hostname')
ok(hostFromUrl('not a url') === '', 'garbage URLs yield an empty host instead of throwing')

/* ---------- 2. shielding decisions ---------- */
const ON = { globalEnabled: true, offHosts: [] }
ok(shouldShieldFor('https://www.youtube.com/', ON) === true, 'shields UP by default on every site')
ok(shouldShieldFor('data:text/html,x', ON) === true, 'hostless pages (data:) are shielded too')
ok(
  shouldShieldFor('https://www.youtube.com/', { globalEnabled: true, offHosts: ['youtube.com'] }) === false,
  'per-site OFF (stored as youtube.com) also matches www.youtube.com'
)
ok(
  shouldShieldFor('https://youtube.com/', { globalEnabled: true, offHosts: ['www.youtube.com'] }) === false,
  'per-site OFF normalizes both directions (no www mismatch)'
)
ok(shouldShieldFor('https://github.com/', { globalEnabled: true, offHosts: ['youtube.com'] }) === true, 'other sites stay shielded')
ok(shouldShieldFor('https://github.com/', { globalEnabled: false, offHosts: [] }) === false, 'global OFF disables everything')
ok(
  shouldShieldFor('https://x.com/', { globalEnabled: false, offHosts: ['x.com'] }) === false,
  'global OFF wins over per-site entries'
)

/* ---------- 3. per-site toggle eligibility ---------- */
ok(canToggleSiteFor('https://www.youtube.com/') === true, 'per-site toggle allowed for https pages')
ok(canToggleSiteFor('http://neverssl.com/') === true, 'per-site toggle allowed for http pages')
ok(canToggleSiteFor('aether://settings') === false, 'internal pages cannot be toggled')
ok(canToggleSiteFor('data:text/html,x') === false, 'data: pages cannot be toggled (nothing to unblock)')

/* ---------- 4. counters ---------- */
let stats = { total: 0, perHost: {} }
stats = recordBlocked(stats, 'youtube.com')
stats = recordBlocked(stats, 'youtube.com')
stats = recordBlocked(stats, 'www.youtube.com')
ok(stats.total === 3, 'every blocked request increments the total')
ok(stats.perHost['youtube.com'] === 3, 'per-site count merges www. into the same site key')
stats = recordBlocked(recordBlocked({ total: 0, perHost: {} }, ''), '')
ok(stats.total === 2 && stats.perHost['(local)'] === 2, 'hostless requests count under a readable "(local)" key')

/* ---------- 5. host-map pruning ---------- */
{
  let perHost = {}
  for (let i = 0; i < MAX_TRACKED_HOSTS + 50; i++) perHost[`host${i}.com`] = 1
  perHost['big.com'] = 9999
  const pruned = pruneHosts(perHost)
  ok(Object.keys(pruned).length === MAX_TRACKED_HOSTS, 'per-host map is pruned to MAX_TRACKED_HOSTS')
  ok(pruned['big.com'] === 9999, 'pruning keeps the most-blocked hosts')
}

/* ---------- 6. filter list resolution ---------- */
ok(FILTER_PRESETS.length >= 2 && FILTER_PRESETS.every((p) => /^https:\/\//.test(p.url)), 'presets are real https filter lists')
ok(
  JSON.stringify(resolveListUrls(['ublock-ads'], [])) === JSON.stringify([FILTER_PRESETS[0].url]),
  'preset id resolves to its list URL'
)
ok(
  resolveListUrls(['ublock-ads', 'ublock-privacy'], ['https://a.example/x.txt']) .length === 3,
  'presets + custom URLs combine'
)
ok(
  resolveListUrls(['ublock-ads'], ['https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt']).length === 1,
  'duplicate URLs are deduped across presets and custom lists'
)
ok(resolveListUrls([], ['http://insecure.example/x.txt', 'not a url', '']).length === 0, 'non-https / garbage list URLs are rejected')
ok(resolveListUrls(['no-such-preset'], []).length === 0, 'unknown preset ids are ignored')

/* ---------- 7. cosmetics merging (main engine + custom engines) ---------- */
ok(mergeCosmetics([]).active === false, 'no engines -> inactive cosmetics')
ok(
  JSON.stringify(mergeCosmetics([{ active: false, styles: '', scripts: [], extended: [] }])) === JSON.stringify(EMPTY_COSMETICS),
  'all engines inactive -> EMPTY_COSMETICS'
)
{
  const m = mergeCosmetics([
    { active: true, styles: '.ad{display:none}', scripts: ['s1();'], extended: ['e1'] },
    { active: true, styles: '.banner{visibility:hidden}', scripts: ['s2();'], extended: ['e2'] },
    { active: false, styles: 'ignored', scripts: ['ignored'], extended: ['ignored'] }
  ])
  ok(m.active === true, 'merged cosmetics active when ANY engine has rules')
  ok(m.styles.includes('.ad{display:none}') && m.styles.includes('.banner{visibility:hidden}'), 'styles from all engines are merged')
  ok(m.scripts.join('|') === 's1();|s2();' && m.extended.join('|') === 'e1|e2', 'scriptlets + extended selectors concatenated in order')
}

/* ---------- 8. site keys stay readable ---------- */
ok(siteKeyFor('youtube.com') === 'youtube.com' && siteKeyFor('') === '(local)', 'site keys: real host kept, empty becomes "(local)"')

console.log(`\nv1.2.0 shields-core: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
