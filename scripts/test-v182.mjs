/**
 * v1.8.0 build 11 — Phase 2: command palette (#37), New Tab v3 quick notes
 * (#44), History v2 day-groups + domain filter (#47).
 *
 * Run:  node scripts/test-v182.mjs
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

/* ---------- bundle shared/fuzzy.ts + main/quicknotes.ts ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test182-'))
const shared = path.join(tmp, 'shared')
fs.mkdirSync(shared, { recursive: true })
fs.cpSync(path.join(APP, 'src', 'shared', 'fuzzy.ts'), path.join(shared, 'fuzzy.ts'))
const stage = path.join(tmp, 'notes')
fs.mkdirSync(stage, { recursive: true })
fs.cpSync(path.join(APP, 'src', 'main', 'quicknotes.ts'), path.join(stage, 'quicknotes.ts'))
fs.writeFileSync(path.join(stage, 'store.ts'), `export class JsonStore { constructor(_n, d) { this.data = d } save() {} }\n`)
const OUTDIR = path.join(APP, '.test-v182-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })

await build({ entryPoints: [path.join(shared, 'fuzzy.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(OUTDIR, 'fuzzy.mjs'), logLevel: 'silent' })
const fz = await import(pathToFileURL(path.join(OUTDIR, 'fuzzy.mjs')).href)
await build({ entryPoints: [path.join(stage, 'quicknotes.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(OUTDIR, 'notes.mjs'), logLevel: 'silent' })
const qn = await import(pathToFileURL(path.join(OUTDIR, 'notes.mjs')).href)

console.log('\n── fuzzyMatch — subsequence + scoring ──')
ok(fz.fuzzyMatch('nt', 'New tab') !== null, 'basic subsequence matches')
eq(fz.fuzzyMatch('xyz', 'New tab'), null, 'non-subsequence rejected')
ok(fz.fuzzyMatch('ntab', 'New tab') !== null, 'gap-tolerant across words')
ok(fz.fuzzyMatch('NT', 'new tab') !== null, 'case-insensitive')
eq(fz.fuzzyMatch('', 'anything')?.score, 0, 'empty query scores 0')
eq(fz.fuzzyMatch('a', ''), null, 'empty target fails')
const m1 = fz.fuzzyMatch('new', 'New tab')
const m2 = fz.fuzzyMatch('new', ' renew watt')
ok(m1 !== null && m2 !== null && m1.score > m2.score, 'word-start bonus: "New tab" outranks mid-word spread')
const b1 = fz.fuzzyMatch('set', 'Settings')
const b2 = fz.fuzzyMatch('set', 'asset turnover')
ok(b1.score > b2.score, 'prefix beats interior match')

console.log('\n── rankBy — ordering, limits, subtitles ──')
const items = [
  { text: 'New tab', sub: 'Ctrl+T' },
  { text: 'Toggle bookmarks bar', sub: 'Ctrl+Shift+B' },
  { text: 'History', sub: 'aether://history' },
  { text: 'Nothing similar here' }
]
const r1 = fz.rankBy(items, 'new tab', 20)
eq(r1[0]?.item.text, 'New tab', 'exact-ish query ranks first')
eq(r1.length, 1, 'non-matching items dropped')
const r2 = fz.rankBy(items, 'hist', 20)
eq(r2[0]?.item.text, 'History', 'subtitle/text match found')
const r3 = fz.rankBy(items, '', 2)
eq(r3.length, 2, 'empty query → original order, capped by limit')
const r4 = fz.rankBy(items, 'b', 20)
ok(r4.length >= 2, 'single letter matches multiple')
const r5 = fz.rankBy(items, 'zzz', 20)
eq(r5.length, 0, 'no matches → empty')

console.log('\n── quick notes (#44) — sanitize + cap ──')
eq(qn.sanitizeNotes(null), '', 'null → empty')
eq(qn.sanitizeNotes(42), '', 'number → empty')
eq(qn.sanitizeNotes('hi\u0000there'), 'hithere', 'NUL stripped')
eq(qn.sanitizeNotes('line1\nline2\tok'), 'line1\nline2\tok', 'newline + tab survive')
eq(qn.sanitizeNotes('a'.repeat(30000)).length, qn.MAX_NOTES, 'over-long notes capped at 20k')

console.log('\n── wiring — palette, newtab, history v2 ──')
const cpSrc = fs.readFileSync(path.join(APP, 'src', 'renderer', 'src', 'components', 'CommandPalette.tsx'), 'utf-8')
ok(cpSrc.includes("from '../../../shared/fuzzy'"), 'palette ranks via the shared pure module')
ok(cpSrc.includes("toLowerCase() === 'k'"), 'Ctrl/Cmd+K binding')
ok(cpSrc.includes('paletteOpen'), 'palette visibility lives in app state')
ok(cpSrc.includes('groupCreate') === false, 'palette stays out of tab-group business')
const appSrc = fs.readFileSync(path.join(APP, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')
ok(appSrc.includes('<CommandPalette />'), 'App mounts the palette')
ok(appSrc.includes('bookmarks.onChanged'), 'palette bookmarks stay fresh')
const storeSrc = fs.readFileSync(path.join(APP, 'src', 'renderer', 'src', 'state', 'store.ts'), 'utf-8')
ok(storeSrc.includes('paletteOpen: false'), 'palette state initialized')
const pagesSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf-8')
ok(pagesSrc.includes("id=\"quicknotes\"") && pagesSrc.includes('window.aether.notes.get()'), 'new tab has the quick-notes widget wired')
ok(pagesSrc.includes('QUICK NOTES'), 'new tab notes section present')
ok(pagesSrc.includes('dayLabel'), 'history v2 day grouping present')
ok(pagesSrc.includes("id=\"domain\""), 'history v2 domain filter present')
ok(pagesSrc.includes('renderDomainPicker'), 'domain picker renders per result set')
const cssSrc = fs.readFileSync(path.join(APP, 'src', 'renderer', 'src', 'styles.css'), 'utf-8')
ok(cssSrc.includes('.cp-overlay') && cssSrc.includes('.cp-item'), 'palette styles present')
const ipcSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf-8')
ok(ipcSrc.includes("'notes:get'") && ipcSrc.includes("'notes:set'"), 'notes IPC handlers present')
ok(ipcSrc.includes("'win:newPrivate'"), 'private-window IPC for the palette')
const apiSrc = fs.readFileSync(path.join(APP, 'src', 'preload', 'api.ts'), 'utf-8')
ok(apiSrc.includes("invoke('notes:get'") && apiSrc.includes("invoke('win:newPrivate'"), 'bridge exposes notes + newPrivate')
const qnSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'quicknotes.ts'), 'utf-8')
ok(qnSrc.includes('MAX_NOTES = 20_000'), 'notes length cap enforced')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(OUTDIR, { recursive: true, force: true })
console.log(`\n═══ test-v182: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
