/**
 * v2.2.0 build 16 — real-browser daily-driver staples:
 *   bookmark import/export codecs (Netscape HTML + Chrome JSON), dedupe,
 *   export round-trip, download-dir resolution, cross-platform profile paths.
 *
 * Run:  node scripts/test-v211.mjs
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

/* ---------- bundle the pure codec module ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test211-'))
async function bundle(relSrc, outName) {
  const stage = path.join(tmp, path.basename(outName, '.mjs'))
  fs.mkdirSync(stage, { recursive: true })
  fs.cpSync(path.join(APP, 'src', relSrc), path.join(stage, path.basename(relSrc)))
  const OUTDIR = path.join(APP, `.test-v211-${path.basename(outName, '.mjs')}`)
  fs.rmSync(OUTDIR, { recursive: true, force: true })
  fs.mkdirSync(OUTDIR, { recursive: true })
  await build({
    entryPoints: [path.join(stage, path.basename(relSrc))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(OUTDIR, outName),
    logLevel: 'silent'
  })
  return import(pathToFileURL(path.join(OUTDIR, outName)).href)
}

const fmt = await bundle('shared/bkmformats.ts', 'bkmformats.mjs')

/* ---------- 1. entity decoding / escaping ---------- */
console.log('── entities ──')
eq(fmt.decodeEntities('Tom &amp; Jerry &lt;3 &quot;x&quot; &#39;ok&#39;'), 'Tom & Jerry <3 "x" \'ok\'', 'named + numeric entities decode')
eq(fmt.decodeEntities('&#x27;smart&#x27; &#x1F600;'), "'smart' \u{1F600}", 'hex + unicode codepoints decode')
eq(fmt.decodeEntities('a&b'), 'a&b', 'bare ampersand passes through')
eq(fmt.escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;', 'escapeHtml covers < > & "')
eq(fmt.decodeEntities(fmt.escapeHtml('<b>"Q" &</b>')), '<b>"Q" &</b>', 'escape/decode round-trip')

/* ---------- 2. keys + timestamps ---------- */
console.log('── keys & timestamps ──')
eq(fmt.bookmarkKey('https://x.com/'), 'https://x.com', 'trailing slash stripped')
eq(fmt.bookmarkKey('  https://X.com/path '), 'https://X.com/path', 'trim only, path case preserved')
eq(fmt.normalizeTs(1690000000), 1690000000000, 'seconds → ms')
eq(fmt.normalizeTs(1690000000000), 1690000000000, 'ms stays ms')
// Chrome epoch: µs since 1601-01-01; 133500000000000000 µs → 2024-04-06T05:20:00Z
eq(fmt.normalizeTs('133500000000000000'), 133500000000000000 / 1e6 - 11644473600000, 'Chrome µs → ms epoch')
const fbTs = fmt.normalizeTs('garbage')
ok(Math.abs(Date.now() - fbTs) < 1000, 'garbage → fallback (now)')

/* ---------- 3. Netscape HTML parser ---------- */
console.log('── Netscape parser ──')
const NETSCAPE = [
  '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
  '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
  '<TITLE>Bookmarks</TITLE>',
  '<H1>Bookmarks</H1>',
  '<DL><p>',
  '    <DT><H3 ADD_DATE="1690000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>',
  '    <DL><p>',
  '        <DT><A HREF="https://example.com/" ADD_DATE="1690000000">Example &amp; Co.</A>',
  '        <DT><A HREF="https://github.com/" ADD_DATE="1690000001">GitHub</A>',
  '    </DL><p>',
  '    <DT><H3>Dev / Tools</H3>',
  '    <DL><p>',
  '        <DT><A HREF="https://nodejs.org/" ADD_DATE="1690000002">Node.js</A>',
  '        <DT><A HREF="javascript:void(0)">bad scheme</A>',
  '        <DT><A HREF="data:text/html,hi">data</A>',
  '        <DT><A HREF="https://untitled.example/"> </A>',
  '    </DL><p>',
  '</DL><p>'
].join('\n')
const parsed = fmt.parseNetscapeBookmarks(NETSCAPE)
eq(parsed.length, 4, 'http(s) kept, javascript:/data: dropped')
eq(parsed[0].title, 'Example & Co.', 'entities decoded in titles')
eq(parsed[0].folder, 'Bookmarks bar', 'top-level folder path')
eq(parsed[2].folder, 'Dev / Tools', 'nested folder path joined with /')
eq(parsed[0].ts, 1690000000000, 'ADD_DATE seconds → ms')
eq(parsed[3].title, 'untitled.example', 'untitled bookmark falls back to hostname')

/* ---------- 4. Chrome JSON parser ---------- */
console.log('── Chrome JSON parser ──')
const CHROME = JSON.stringify({
  roots: {
    bookmark_bar: {
      type: 'folder',
      name: 'Bookmarks bar',
      children: [
        { type: 'url', name: 'Aether', url: 'https://aether.test/', date_added: '133500000000000000' },
        {
          type: 'folder',
          name: 'Read later',
          children: [{ type: 'url', name: 'Spec', url: 'https://spec.test/x/', date_added: '133500000000000001' }]
        }
      ]
    },
    other: { type: 'folder', name: 'Other bookmarks', children: [{ type: 'url', name: 'Wiki', url: 'https://w.test/' }] },
    synced: { type: 'folder', name: 'Mobile bookmarks', children: [] },
    ignored_root: { type: 'url', name: 'nope', url: 'https://ignored.test/' }
  }
})
const chromeParsed = fmt.parseChromeBookmarksJson(CHROME)
eq(chromeParsed.length, 3, 'three roots walked, unknown roots ignored')
eq(chromeParsed[0].title, 'Aether', 'url node title')
ok(chromeParsed[0].folder === 'Bookmarks bar', 'bookmark_bar root labeled')
eq(chromeParsed[1].folder, 'Bookmarks bar / Read later', 'nested folder path')
eq(chromeParsed[1].ts, 133500000000000001 / 1e6 - 11644473600000, 'Chrome µs date converted')
eq(fmt.parseChromeBookmarksJson('{broken'), [], 'invalid JSON → []')
eq(fmt.parseChromeBookmarksJson('{}'), [], 'missing roots → []')

/* ---------- 5. file sniffing ---------- */
console.log('── file sniffing ──')
eq(fmt.parseBookmarkFile(CHROME).length, 3, 'JSON content → Chrome parser')
eq(fmt.parseBookmarkFile(NETSCAPE).length, 4, 'HTML content → Netscape parser')

/* ---------- 6. dedupe ---------- */
console.log('── dedupe ──')
const existing = [{ url: 'https://github.com/', title: 'GitHub', ts: 1 }]
const incoming = [
  { url: 'https://github.com', title: 'dup trailing slash', ts: 2 },
  { url: 'https://github.com/', title: 'exact dup', ts: 3 },
  { url: 'https://new.example/', title: 'fresh', ts: 4 },
  { url: 'https://new.example', title: 'in-batch dup', ts: 5 }
]
const deduped = fmt.dedupeBookmarks(existing, incoming)
eq(deduped.map((b) => b.url), ['https://new.example/'], 'existing + in-batch dupes skipped, trailing-slash match')
eq(fmt.dedupeBookmarks([], []).length, 0, 'empty in, empty out')
// library cap: 2 slots left, 5 incoming → 2 kept
const nearCap = Array.from({ length: fmt.LIBRARY_CAP - 2 }, (_, i) => ({ url: `https://p${i}.test/`, title: 'p', ts: 0 }))
eq(fmt.dedupeBookmarks(nearCap, Array.from({ length: 5 }, (_, i) => ({ url: `https://n${i}.test/`, title: 'n', ts: 0 }))).length, 2, 'library cap enforced')

/* ---------- 7. export round-trip ---------- */
console.log('── Netscape export ──')
const library = [
  { url: 'https://loose.test/', title: 'Loose & <free>', ts: 1700000000000 },
  { url: 'https://a.test/', title: 'In folder', ts: 1700000001000, folder: 'Bookmarks bar / Work' },
  { url: 'https://b.test/', title: 'Also work', ts: 1700000002000, folder: 'Bookmarks bar / Work' }
]
const exported = fmt.buildNetscapeExport(library)
ok(exported.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'), 'export header present')
ok(exported.includes('ADD_DATE="1700000000"'), 'ADD_DATE seconds written')
ok(exported.includes('Loose &amp; &lt;free&gt;'), 'titles escaped on export')
const round = fmt.parseNetscapeBookmarks(exported)
eq(round.length, 3, 'round-trip: same count')
eq(round.map((b) => b.url), ['https://loose.test/', 'https://a.test/', 'https://b.test/'], 'round-trip: order kept')
eq(round[1].folder, 'Bookmarks bar / Work', 'round-trip: folder preserved')

/* ---------- 8. cross-platform profile dirs ---------- */
console.log('── profile dir candidates ──')
const HOME = 'C:\\Users\\may' === 'never' ? '' : '/home/may'
const LOCAL = '/localappdata'
eq(fmt.candidateBaseDirs('Chrome', { home: HOME, localAppData: LOCAL, platform: 'win32' }), [`${LOCAL}/Google/Chrome/User Data`], 'win32 Chrome')
eq(fmt.candidateBaseDirs('Edge', { home: HOME, localAppData: LOCAL, platform: 'win32' }), [`${LOCAL}/Microsoft/Edge/User Data`], 'win32 Edge')
eq(fmt.candidateBaseDirs('Brave', { home: HOME, localAppData: LOCAL, platform: 'darwin' }), [`${HOME}/Library/Application Support/BraveSoftware/Brave-Browser`], 'macOS Brave')
eq(
  fmt.candidateBaseDirs('Chrome', { home: HOME, localAppData: LOCAL, platform: 'linux' }),
  [`${HOME}/.config/google-chrome`, `${HOME}/.config/google-chrome-beta`],
  'linux Chrome (stable + beta)'
)
eq(fmt.candidateBaseDirs('Firefox', { home: HOME, localAppData: LOCAL, platform: 'linux' }), [], 'unknown browser → [] (Firefox uses its own store)')

/* ---------- 9. download dir resolution ---------- */
console.log('── download dir ──')
const fakeExists = (p) => p === '/real/dir'
eq(fmt.resolveDownloadDir('/real/dir', '/fallback', fakeExists), '/real/dir', 'configured dir wins when it exists')
eq(fmt.resolveDownloadDir('/missing/dir', '/fallback', fakeExists), '/fallback', 'missing configured dir → fallback')
eq(fmt.resolveDownloadDir('', '/fallback', fakeExists), '/fallback', 'empty configured dir → fallback')
eq(fmt.resolveDownloadDir('   ', '/fallback', fakeExists), '/fallback', 'whitespace configured dir → fallback')
eq(fmt.resolveDownloadDir(undefined, '/fallback', fakeExists), '/fallback', 'undefined configured dir → fallback')

/* ---------- done ---------- */
console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
