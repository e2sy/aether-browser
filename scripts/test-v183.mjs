/**
 * v1.8.0 build 12 — Phase 2: reading list (#46), context menu v2 (#45),
 * sound control (#53), force-dark v2 (#52).
 *
 * Run:  node scripts/test-v183.mjs
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

/* ---------- bundle readinglist.ts + darkmode.ts ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test183-'))
async function bundle(srcFile, outName) {
  const stage = path.join(tmp, path.basename(outName, '.mjs'))
  fs.mkdirSync(stage, { recursive: true })
  fs.cpSync(path.join(APP, 'src', 'main', srcFile), path.join(stage, path.basename(srcFile)))
  fs.writeFileSync(path.join(stage, 'store.ts'), `export class JsonStore { constructor(_n, d) { this.data = d } save() {} }\n`)
  const OUTDIR = path.join(APP, `.test-v183-${path.basename(outName, '.mjs')}`)
  fs.rmSync(OUTDIR, { recursive: true, force: true })
  fs.mkdirSync(OUTDIR, { recursive: true })
  await build({ entryPoints: [path.join(stage, path.basename(srcFile))], bundle: true, platform: 'node', format: 'esm', outfile: path.join(OUTDIR, outName), logLevel: 'silent' })
  return import(pathToFileURL(path.join(OUTDIR, outName)).href)
}
const rl = await bundle('readinglist.ts', 'readinglist.mjs')
const dm = await bundle('darkmode.ts', 'darkmode.mjs')

console.log('\n── reading time estimates (#46) ──')
eq(rl.readingMinutes(0), 0, 'no words → 0 (unknown)')
eq(rl.readingMinutes(100), 1, 'short page min 1 minute')
eq(rl.readingMinutes(460), 2, '230 wpm → 460 words = 2 minutes')
eq(rl.readingMinutes(461), 3, 'rounds up')

console.log('\n── reading list operations ──')
let list = []
list = rl.addReadingItem(list, { url: 'https://a.com/x', title: 'Article A', words: 690 })
list = rl.addReadingItem(list, { url: 'https://b.com/y', title: 'Article B' })
eq(list.length, 2, 'two items added')
eq(list[0].url, 'https://b.com/y', 'newest first')
eq(list[1].minutes, 3, '690 words → 3 minutes')
eq(list[0].minutes, null, 'no word count → null estimate')
list = rl.addReadingItem(list, { url: 'https://a.com/x', title: 'Article A again' })
eq(list.length, 2, 're-add dedupes')
eq(list[0].url, 'https://a.com/x', 're-add moves to top')
eq(list[0].read, false, 're-add marks unread')
eq(list[0].minutes, null, 're-add without words resets estimate')
list = rl.addReadingItem(list, { url: 'file:///etc/passwd' })
eq(list.length, 2, 'non-http URLs rejected')
list = rl.toggleReadingRead(list, 'https://a.com/x')
eq(list[0].read, true, 'toggle marks read')
list = rl.toggleReadingRead(list, 'https://a.com/x')
eq(list[0].read, false, 'toggle back')
list = rl.removeReadingItem(list, 'https://a.com/x')
eq(list.length, 1, 'remove works')

console.log('\n── sanitize — hostile blobs fail closed ──')
eq(rl.sanitizeReadingList('nope'), [], 'non-array → []')
const dirty = rl.sanitizeReadingList([
  null,
  { url: 'javascript:alert(1)', title: 'xss' },
  { url: 'https://ok.com', title: 42, addedTs: -5, minutes: 999999 },
  { url: 'https://ok.com', title: 'dup' },
  { url: 'https://good.com' }
])
eq(dirty.length, 2, 'junk + dupes dropped, valid kept')
eq(dirty[0].title, 'https://ok.com', 'bad title falls back to url')
eq(dirty[0].minutes, null, 'absurd minutes rejected')
ok(dirty[0].addedTs > 0, 'bad timestamp filled with now')

console.log('\n── force-dark policy (#52) ──')
eq(dm.inNightHours(new Date(2026, 0, 1, 21, 0)), true, '21:00 is night')
eq(dm.inNightHours(new Date(2026, 0, 1, 3, 30)), true, '03:30 is night')
eq(dm.inNightHours(new Date(2026, 0, 1, 12, 0)), false, 'noon is day')
eq(dm.inNightHours(new Date(2026, 0, 1, 19, 59)), false, '19:59 is day')
eq(dm.inNightHours(new Date(2026, 0, 1, 20, 0)), true, '20:00 sharp is night')

eq(dm.cleanHosts(['  https://www.Example.com/path ', 'NEWS.org', 'example.com', 'not a host', '']), ['example.com', 'news.org'], 'host list normalized + deduped')
eq(dm.cleanHosts('nope'), [], 'non-array → []')

const day = new Date(2026, 0, 1, 12, 0)
const night = new Date(2026, 0, 1, 22, 0)
eq(dm.shouldForceDark('example.com', { mode: 'off', hosts: ['example.com'] }, day), false, 'mode off → never')
eq(dm.shouldForceDark('example.com', { mode: 'always', hosts: ['example.com'] }, day), true, 'always + listed → yes')
eq(dm.shouldForceDark('example.com', { mode: 'always', hosts: ['other.com'] }, day), false, 'not listed → no')
eq(dm.shouldForceDark('www.example.com', { mode: 'always', hosts: ['example.com'] }, day), true, 'www stripped on compare')
eq(dm.shouldForceDark('example.com', { mode: 'night', hosts: ['example.com'] }, day), false, 'night mode during day → no')
eq(dm.shouldForceDark('example.com', { mode: 'night', hosts: ['example.com'] }, night), true, 'night mode at night → yes')
eq(dm.shouldForceDark('', { mode: 'always', hosts: ['a.com'] }, day), false, 'empty host fails closed')

console.log('\n── wiring — page, IPC, preload, menu, settings ──')
const pagesSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf-8')
ok(pagesSrc.includes('READINGLIST_HTML') && pagesSrc.includes('window.aether.reading.list'), 'reading-list page wired to the bridge')
ok(pagesSrc.includes("id=\"showread\""), 'hide-read toggle present')
ok(pagesSrc.includes("id=\"fdMode\"") && pagesSrc.includes("id=\"fdHosts\""), 'force-dark settings controls present')
ok(pagesSrc.includes('forceDarkMode'), 'force-dark settings load/save wired')
const ipcSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf-8')
ok(ipcSrc.includes("'reading:list'") && ipcSrc.includes("'reading:add'") && ipcSrc.includes("'reading:toggle'"), 'reading IPC handlers present')
const apiSrc = fs.readFileSync(path.join(APP, 'src', 'preload', 'api.ts'), 'utf-8')
ok(apiSrc.includes('reading:add') && apiSrc.includes('toggleRead'), 'bridge exposes reading methods')
const menuSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'menu.ts'), 'utf-8')
ok(menuSrc.includes('Add to reading list'), 'context menu adds pages to the reading list')
// v2.5.0 renamed + moved: the shot tool lives in main/shot.ts (save + W3C clipboard copy)
ok(menuSrc.includes('Screenshot — save & copy') && menuSrc.includes('captureScreenshot(wc)'), 'context menu screenshots the page')
ok(menuSrc.includes('Mute all tabs') && menuSrc.includes('Unmute all tabs'), 'sound control menu items (#53)')
ok(menuSrc.includes('aether://readinglist'), 'menu entry opens the reading list')
const tabsSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'tabs.ts'), 'utf-8')
ok(tabsSrc.includes('muteAll(muted'), 'TabManager.muteAll exists (#53)')
ok(tabsSrc.includes('wireForceDark'), 'force-dark wired on every spawned view')
const idxSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'index.ts'), 'utf-8')
ok(idxSrc.includes('readinglist: READINGLIST_HTML'), 'aether://readinglist route registered')
const extSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'extproto.ts'), 'utf-8')
ok(extSrc.includes("'readinglist'"), 'readinglist routable from outside (aether:// scheme)')
const typesSrc = fs.readFileSync(path.join(APP, 'src', 'shared', 'types.ts'), 'utf-8')
ok(typesSrc.includes("forceDarkMode: 'off' | 'always' | 'night'"), 'force-dark setting typed')
const storeSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'store.ts'), 'utf-8')
ok(storeSrc.includes("forceDarkMode: 'off'") && storeSrc.includes('forceDarkHosts: []'), 'force-dark defaults conservative')
const darkSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'darkmode.ts'), 'utf-8')
ok(darkSrc.includes("cssOrigin: 'user'"), 'dark CSS injected as user origin (page cannot remove)')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
for (const d of fs.readdirSync(APP)) {
  if (d.startsWith('.test-v183-')) fs.rmSync(path.join(APP, d), { recursive: true, force: true })
}
console.log(`\n═══ test-v183: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
