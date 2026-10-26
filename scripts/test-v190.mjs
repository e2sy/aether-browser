/**
 * v2.1.0 build 15 — omnibox suggestions v2 (multi-engine feed, stale-guard,
 * shared row policy) + window controls resized/flush (vertical mode inline).
 *
 * Run:  node scripts/test-v190.mjs
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
  ok(sa === sb, `${name} (got ${sa?.slice(0, 120)}, want ${sb?.slice(0, 120)})`)
}

/* ---------- bundle pure modules ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test190-'))
async function bundle(relSrc, outName, extra = {}) {
  const stage = path.join(tmp, path.basename(outName, '.mjs'))
  fs.mkdirSync(stage, { recursive: true })
  fs.cpSync(path.join(APP, 'src', relSrc), path.join(stage, path.basename(relSrc)))
  const OUTDIR = path.join(APP, `.test-v190-${path.basename(outName, '.mjs')}`)
  fs.rmSync(OUTDIR, { recursive: true, force: true })
  fs.mkdirSync(OUTDIR, { recursive: true })
  await build({
    entryPoints: [path.join(stage, path.basename(relSrc))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(OUTDIR, outName),
    logLevel: 'silent',
    ...extra
  })
  return import(pathToFileURL(path.join(OUTDIR, outName)).href)
}

const omni = await bundle('shared/omnibox.ts', 'omnibox.mjs')
const eng = await bundle('main/search-engine.ts', 'engine.mjs')

/* ---------- 1. isDomainLike + hostOf ---------- */
console.log('── domain detection ──')
ok(omni.isDomainLike('youtube.com') === true, 'bare domain is domain-like')
ok(omni.isDomainLike('example.com/watch?v=1') === true, 'domain+path is domain-like')
ok(omni.isDomainLike('example.com:8080') === true, 'domain+port is domain-like')
ok(omni.isDomainLike('two words.com') === false, 'spaces are never domain-like')
ok(omni.isDomainLike('https://example.com') === false, 'a full URL is not domain-like (already a URL)')
ok(omni.isDomainLike('hello') === false, 'bare word is not domain-like')
ok(omni.isDomainLike('') === false, 'empty is not domain-like')
eq(omni.hostOf('https://www.example.com/a?b=1'), 'example.com', 'hostOf strips www')
eq(omni.hostOf('not a url'), '', 'hostOf survives garbage')

/* ---------- 2. buildOmniboxRows: order, caps, dedupe ---------- */
console.log('── omnibox row policy ──')
eq(omni.buildOmniboxRows('', {}), [], 'empty input → no rows')

let rows = omni.buildOmniboxRows('youtu', {
  history: [{ url: 'https://youtube.com/x', title: 'YouTube watch', host: 'youtube.com' }],
  bookmarks: [{ url: 'https://youtube.com/', title: 'YouTube' }],
  suggestions: ['youtube', 'youtube music', 'youtu.be']
})
ok(rows[0].kind === 'search' && rows[0].value === 'youtu', 'static search row comes first for non-domains')
ok(rows.some((r) => r.kind === 'search' && r.value === 'youtube music'), 'engine suggestions included')
ok(rows.some((r) => r.kind === 'history' && r.value === 'https://youtube.com/x'), 'history row included')
ok(rows.some((r) => r.kind === 'bookmark' && r.value === 'https://youtube.com/'), 'bookmark row included')

rows = omni.buildOmniboxRows('example.com', { suggestions: ['example.com download'] })
ok(rows[0].kind === 'url' && rows[0].label === 'Go to example.com', 'URL row is FIRST for domain-like input')
ok(rows[1].kind === 'search', 'search row follows the URL row')

rows = omni.buildOmniboxRows('youtube', {
  suggestions: ['YouTube', 'youtube tv'],
  history: [{ url: 'youtube', title: 'weird' }],
  bookmarks: [{ url: 'youtube', title: 'dup' }]
})
ok(!rows.some((r) => r.kind === 'search' && r.value === 'YouTube'), 'exact (case-insensitive) engine suggestion skipped')
ok(rows.filter((r) => r.value.toLowerCase() === 'youtube').length === 1, 'value-level dedupe: one youtube row only')

const many = []
for (let i = 0; i < 10; i++) many.push({ url: `https://h${i}.com/a`, title: `h${i}`, host: `h${i}.com` })
rows = omni.buildOmniboxRows('q', { history: many, bookmarks: many.map((m) => ({ url: m.url })) })
ok(rows.filter((r) => r.kind === 'history').length === 3, 'history capped at 3')
ok(rows.filter((r) => r.kind === 'bookmark').length === 2, 'bookmarks capped at 2')
ok(rows.length <= omni.OMNIBOX_ROW_CAP, `total capped at ${omni.OMNIBOX_ROW_CAP}`)

const sugFlood = Array.from({ length: 20 }, (_, i) => `suggestion ${i}`)
rows = omni.buildOmniboxRows('q', { suggestions: sugFlood })
ok(rows.filter((r) => r.kind === 'search' && r.value !== 'q').length === 7, 'engine suggestions capped at 7')

rows = omni.buildOmniboxRows('x', { history: [{ url: 'https://www.test.com/p' }] })
const hRow = rows.find((r) => r.kind === 'history')
ok(hRow && hRow.sub === 'test.com', 'history row without host falls back to hostOf')

/* ---------- 3. suggest payload parsing (3 engine shapes) ---------- */
console.log('── payload parsing ──')
eq(eng.parseSuggestPayload('["q",["a","b","c"]]'), ['a', 'b', 'c'], 'firefox-client shape [q,[...]]')
eq(eng.parseSuggestPayload('[{"phrase":"alpha"},{"phrase":"beta"}]'), ['alpha', 'beta'], 'DDG phrase shape')
eq(eng.parseSuggestPayload('garbage{'), [], 'garbage → []')
eq(eng.parseSuggestPayload('{"nope":1}'), [], 'non-array JSON → []')
eq(eng.parseSuggestPayload('["q",[1,2,"real"]]'), ['real'], 'non-strings filtered in firefox shape')
eq(eng.parseSuggestPayload(''), [], 'empty body → []')

/* ---------- 4. mergeSuggestFeeds: round-robin, dedupe, cap ---------- */
console.log('── feed merge ──')
eq(eng.mergeSuggestFeeds([['a1', 'a2'], ['b1', 'b2']], 4), ['a1', 'b1', 'a2', 'b2'], 'round-robin interleave across engines')
eq(eng.mergeSuggestFeeds([['same', 'x'], ['SAME', 'y']], 4), ['same', 'x', 'y'], 'case-insensitive dedupe, earlier engine wins')
eq(eng.mergeSuggestFeeds([['a', 'b', 'c']], 2), ['a', 'b'], 'cap respected')
eq(eng.mergeSuggestFeeds([[], [], []], 3), [], 'all-empty feeds → []')
eq(eng.mergeSuggestFeeds([['a'], 'garbage', ['b']], 3), ['a', 'b'], 'garbage feed tolerated')
eq(eng.mergeSuggestFeeds([['a', 'b'], ['c']], 10), ['a', 'c', 'b'], 'shorter feed does not starve')

/* ---------- 5. endpoints + thresholds ---------- */
console.log('── endpoints ──')
ok(eng.SUGGEST_ENDPOINTS.length === 3, 'three suggest engines')
ok(eng.SUGGEST_ENDPOINTS.map((e) => e.name).join(',') === 'duckduckgo,google,bing', 'DDG + Google + Bing')
ok(eng.SUGGEST_ENDPOINTS[1].url('hi there').includes('hi%20there'), 'queries are URL-encoded')
eq(await eng.searchSuggestionsMulti('x'), [], 'multi feed short-circuits <2 chars (no network)')

/* ---------- 6. wiring gates (source checks) ---------- */
console.log('── wiring gates ──')
const ipcSrc = fs.readFileSync(path.join(APP, 'src/main/ipc.ts'), 'utf8')
ok(ipcSrc.includes('remote = await searchSuggestionsMulti(text, 1200)'), 'omnibox:suggest uses the multi-engine feed')
ok(ipcSrc.includes('text.trim().length >= 2'), 'omnibox feed threshold lowered to 2 chars')
ok(ipcSrc.includes('return searchSuggestionsMulti(String(payload?.q || \'\'))'), 'internal:suggest uses the multi feed')
ok(!ipcSrc.includes('searchSuggestions('), 'single-engine searchSuggestions no longer called in ipc')

const tbSrc = fs.readFileSync(path.join(APP, 'src/renderer/src/components/Toolbar.tsx'), 'utf8')
ok(tbSrc.includes('const mySeq = ++reqSeq.current'), 'stale-guard: sequence captured per request')
ok(tbSrc.includes('if (mySeq !== reqSeq.current) return'), 'stale-guard: stale responses dropped')
ok(tbSrc.includes('buildOmniboxRows(text, { history, bookmarks, suggestions })'), 'rows built by the shared pure policy')
ok(!tbSrc.includes('DOMAINISH'), 'local DOMAINISH copy removed (single source of truth)')
ok(tbSrc.includes("vertical && window.aether.platform !== 'darwin'"), 'vertical mode renders inline win-controls in the toolbar')

const appSrc = fs.readFileSync(path.join(APP, 'src/renderer/src/App.tsx'), 'utf8')
ok(!appSrc.includes('win-controls-float'), 'App no longer renders the floating controls box')

const css = fs.readFileSync(path.join(APP, 'src/renderer/src/styles.css'), 'utf8')
ok(css.includes('width: 46px'), 'control buttons are Windows-native 46px wide')
ok(!css.includes('.win-controls-float'), 'dead .win-controls-float CSS deleted')
ok(css.includes('.tabstrip .win-controls') && css.includes('.toolbar .win-controls'), 'flush-right overrides for both rows')
ok(css.includes('align-self: stretch'), 'cluster stretches to its row height')
ok(!css.includes('height: 36px;\n  flex: none;\n  margin-left: auto;\n}'), 'old fixed-36px cluster removed')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
for (const d of fs.readdirSync(APP)) {
  if (d.startsWith('.test-v190-')) fs.rmSync(path.join(APP, d), { recursive: true, force: true })
}
console.log(`\n═══ test-v190: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
