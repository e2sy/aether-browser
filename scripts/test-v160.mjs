/**
 * v1.6.0 Aether Search Beast Mode tests.
 *
 * Covers: the bang table + resolver, instant answers v2 (units, percentages,
 * world clock), the domain-diversity ranking pass, the new Wikipedia and
 * Mojeek source parsers, and source-engine registry contents. Everything is
 * pure — parsers run on fixtures, no network anywhere.
 *
 * Run:  node scripts/test-v160.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test160-'))
fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

const entry = path.join(tmp, 'src', 'main', 'testable-v160.ts')
fs.writeFileSync(
  entry,
  `export { resolveBang, startsWithBang, popularBangs, BANGS } from './bangs'
   export { parseUnitQuery, unitAnswer, percentAnswer, timeAnswer, instantAnswerV2, CITY_TZ } from './instant'
   export { evaluateMath, instantAnswer as calcInstant, diversify, hostOf, aggregateRanked } from './search-engine'
   export { parseWikipediaResults, parseMojeekResults, ENGINE_NAMES } from './search'`
)

// the bundle lands INSIDE the app tree so `import { JSDOM } from 'jsdom'`
// resolves the real installed dependency at runtime
const OUTDIR = path.join(APP, '.test-v160-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  // jsdom stays external: esbuild would choke bundling it, and at runtime the
  // bundle sits inside the app tree so Node resolves the real installed copy
  external: ['jsdom'],
  outfile: path.join(OUTDIR, 'bundle.mjs'),
  logLevel: 'silent'
})

const B = await import(pathToFileURL(path.join(OUTDIR, 'bundle.mjs')).href)
const {
  resolveBang, startsWithBang, popularBangs, BANGS,
  parseUnitQuery, unitAnswer, percentAnswer, timeAnswer, instantAnswerV2, CITY_TZ,
  evaluateMath, calcInstant, diversify, hostOf, aggregateRanked,
  parseWikipediaResults, parseMojeekResults, ENGINE_NAMES
} = B

/* ================= 1. bangs ================= */
console.log('\n[1] DuckDuckGo-style bangs')
{
  const r = resolveBang('!yt lofi beats')
  ok(r && r.bang === 'yt' && r.name === 'YouTube', 'resolveBang !yt picks YouTube')
  eq(r?.query, 'lofi beats', 'bang query stripped of the token')
  eq(r?.url, 'https://www.youtube.com/results?search_query=lofi%20beats', 'bang URL encodes the query')

  const g = resolveBang('!g')
  ok(g && g.bang === 'g' && g.url === 'https://www.google.com' && g.query === '', 'bare bang opens home page')

  eq(resolveBang('!yk cats'), null, 'unknown bang falls through to normal search')
  eq(resolveBang('just cats'), null, 'no bang token → null')
  eq(resolveBang(''), null, 'empty query → null')

  const m = resolveBang('  !!yt  cats ')
  ok(m && m.bang === 'yt' && m.query === 'cats', 'mashed !!bang + extra spaces still resolve')

  const chain = resolveBang('!g !yt cats')
  ok(chain && chain.bang === 'yt' && chain.query === 'cats', 'chained bangs: last known one wins')

  ok(startsWithBang('!yt x') === true, 'startsWithBang true for !token')
  ok(startsWithBang('yt x') === false, 'startsWithBang false without !')
  ok(startsWithBang('! x') === false, 'startsWithBang false for bare !')

  const pop = popularBangs(3)
  eq(pop.map((p) => p.key), ['g', 'yt', 'w'], 'popularBangs dedupes by name, table order')
  ok(BANGS.length >= 40, 'bang table ships 40+ destinations (' + BANGS.length + ')')
  const keys = new Set(BANGS.map((b) => b.key))
  ok(keys.size === BANGS.length, 'bang keys are unique')
  ok(BANGS.some((b) => b.key === 'fk' && /flipkart\.com/.test(b.url)), 'Flipkart bang present for India users')
}

/* ================= 2. instant answers v2 — units ================= */
console.log('\n[2] unit conversions')
{
  const km = unitAnswer('10 km to miles')
  ok(km && km.kind === 'unit', '10 km to miles is a unit answer')
  eq(km?.output, '6.213712 miles', '10 km = 6.213712 miles')

  const f = unitAnswer('72 f to c')
  ok(f && f.output === '22.222222°C', '72°F = 22.222222°C (compact from-unit)')

  const gb = unitAnswer('1 gb to mb')
  ok(gb && gb.output === '1000 megabytes', '1 GB = 1000 MB (decimal)')

  const ms = unitAnswer('500 ms to s')
  ok(ms && ms.output === '0.5 seconds', 'ms means milliseconds, not m/s')

  const inr = unitAnswer('6 feet in inches')
  ok(inr && inr.output === '72 inches', 'long unit names work')

  const bad = unitAnswer('10 km to kg')
  eq(bad, null, 'cross-dimension conversion refused')

  eq(unitAnswer('10 to 12'), null, 'unit-less "10 to 12" is not a conversion')
  eq(parseUnitQuery('10 km to miles'), { value: 10, from: 'km', to: 'miles' }, 'parseUnitQuery components')
}

/* ================= 3. instant answers v2 — percent + time ================= */
console.log('\n[3] percentages + world clock')
{
  const p = percentAnswer('15% of 80')
  ok(p && p.output === '12' && p.input === '15% of 80', '15% of 80 = 12')
  const p2 = percentAnswer('what is 12.5 percent of 200')
  ok(p2 && p2.output === '25', 'long form + decimals: 12.5% of 200 = 25')
  eq(percentAnswer('15 of 80'), null, 'missing % is not a percent answer')

  const NOW = new Date('2026-01-15T12:34:56Z')
  const tyo = timeAnswer('time in tokyo', NOW)
  ok(tyo && tyo.output === '21:34', 'time in tokyo = 21:34 for 12:34Z')
  ok(tyo && /Japan/.test(tyo.detail), 'tokyo detail names Japan')

  const del = timeAnswer('what time is it in delhi', NOW)
  ok(del && del.output === '18:04', 'Indian metro via natural phrasing (IST +5:30)')

  const ny = timeAnswer('time in new york', NOW)
  ok(ny && ny.output === '07:34', 'DST-correct US Eastern (January = EST)')

  const local = timeAnswer('time', NOW)
  ok(local && /^\d{2}:\d{2}$/.test(local.output), 'bare "time" answers in device timezone format')

  const date = timeAnswer('date', NOW)
  ok(date && date.output === 'Thursday, 15 January 2026', '"date" answers the full date (UTC-deterministic)')

  eq(timeAnswer('time in atlantis', NOW), null, 'unknown city → null')
  eq(timeAnswer('timer settings', NOW), null, 'non-time query → null')
  ok('mumbai' in CITY_TZ && 'singapore' in CITY_TZ && 'london' in CITY_TZ, 'city map covers India + world')
}

/* ================= 4. dispatch order ================= */
console.log('\n[4] instantAnswerV2 dispatch')
{
  const deps = { evaluateMath }
  eq(instantAnswerV2('', deps), null, 'empty → null')
  const c = instantAnswerV2('2+2', deps)
  ok(c && c.kind === 'calc' && c.output === '4', 'pure math routes to calculator')
  const u = instantAnswerV2('10 km to miles', deps)
  ok(u && u.kind === 'unit', 'unit query routes to converter')
  const pc = instantAnswerV2('15% of 80', deps)
  ok(pc && pc.kind === 'percent', 'percent query routes to percent')
  const t = instantAnswerV2('time in tokyo', deps, new Date('2026-01-15T12:34:56Z'))
  ok(t && t.kind === 'time', 'time query routes to world clock')
  eq(instantAnswerV2('best keyboards 2026', deps), null, 'normal queries stay null (search proceeds)')
  // v1.3 calculator contract intact
  const legacy = calcInstant('3*7')
  ok(legacy && legacy.type === 'calc' && legacy.output === '21', 'v1.3 instantAnswer contract unchanged')
}

/* ================= 5. diversity ranking ================= */
console.log('\n[5] domain-diversity pass')
{
  ok(hostOf('https://www.YouTube.com/watch?v=1') === 'youtube.com', 'hostOf lowercases + strips www')

  const yt = (u, t) => ({ url: 'https://youtube.com/' + u, title: t || u, snippet: '' })
  const gh = (u, t) => ({ url: 'https://github.com/' + u, title: t || u, snippet: '' })
  const so = (u, t) => ({ url: 'https://stackoverflow.com/' + u, title: t || u, snippet: '' })

  const mixed = diversify([yt('a'), yt('b'), gh('c'), yt('d'), so('e')], 5)
  ok(mixed.length === 5, 'diversify preserves all results')
  const hosts = mixed.map((r) => hostOf(r.url))
  let clumps = 0
  for (let i = 1; i < hosts.length; i++) if (hosts[i] === hosts[i - 1]) clumps++
  ok(clumps === 0, 'no two consecutive results share a host when others exist (' + hosts.join(',') + ')')

  const forced = diversify([yt('a'), yt('b'), yt('c')], 3)
  ok(forced.length === 3 && hostOf(forced[0].url) === 'youtube.com', 'all-same-host input degrades to original order')

  const ranked = aggregateRanked(
    [
      { source: 'DDG', results: [yt('a', 'qwen model'), yt('b', 'qwen model'), yt('c', 'qwen model')] },
      { source: 'Bing', results: [gh('x', 'qwen model'), so('y', 'qwen model')] }
    ],
    'qwen model',
    5
  )
  const rhosts = ranked.map((r) => hostOf(r.url))
  let rclumps = 0
  for (let i = 1; i < rhosts.length; i++) if (rhosts[i] === rhosts[i - 1]) rclumps++
  ok(ranked.length === 5 && rclumps === 0, 'aggregateRanked output is diverse across sources')
  ok(ranked[0].source === 'DDG', 'best-ranked lane still owns the top slot')
}

/* ================= 6. Wikipedia source ================= */
console.log('\n[6] Wikipedia parser')
{
  const fixture = JSON.stringify({
    query: {
      pages: [
        {
          title: 'Electron (software framework)',
          extract: 'Electron is a free and open-source software framework developed and maintained by OpenJS Foundation.',
          fullurl: 'https://en.wikipedia.org/wiki/Electron_(software_framework)',
          thumbnail: { source: 'https://upload.wikimedia.org/thumb.jpg' }
        },
        { title: 'Chromium (web browser)', extract: 'Chromium is a free and open-source web browser.' }
      ]
    }
  })
  const rs = parseWikipediaResults(fixture, 5)
  eq(rs.length, 2, 'two wiki pages parsed')
  ok(rs[0].url === 'https://en.wikipedia.org/wiki/Electron_(software_framework)', 'fullurl respected')
  ok(rs[0].snippet.startsWith('Electron is a free'), 'extract becomes the snippet')
  eq(parseWikipediaResults('not json at all', 5), [], 'garbage body → empty, never throws')
  eq(parseWikipediaResults('{"query":{"pages":[]}}', 5), [], 'empty pages → empty')
  ok(ENGINE_NAMES.includes('Wikipedia'), 'Wikipedia registered as a source')
}

/* ================= 7. Mojeek source ================= */
console.log('\n[7] Mojeek parser')
{
  const fixture = `
  <html><body><ul class="results-standard">
    <li><h2><a class="title" href="https://example.com/a">Example A</a></h2><p class="s">Snippet A text here</p></li>
    <li><h2><a class="title" href="/relative/one">Relative link</a></h2><p class="s">Should be dropped</p></li>
    <li><h2><a class="title" href="https://example.org/b">Example B</a></h2><p>Longer fallback snippet paragraph that passes the twenty char bar easily.</p></li>
  </ul></body></html>`
  const rs = parseMojeekResults(fixture, 8)
  eq(rs.length, 2, 'absolute links parsed, relative dropped')
  eq(rs[0].url, 'https://example.com/a', 'first result URL')
  eq(rs[0].snippet, 'Snippet A text here', 'p.s snippet picked')
  eq(parseMojeekResults('<html></html>', 8), [], 'empty page → empty')
  ok(ENGINE_NAMES.includes('Mojeek'), 'Mojeek registered as a source')
  eq(ENGINE_NAMES.length, 5, 'five sources run in parallel (' + ENGINE_NAMES.join(', ') + ')')
}

/* ================= done ================= */
console.log(`\nv1.6.0 beast search: ${pass} passed, ${fail} failed`)
fs.rmSync(OUTDIR, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
