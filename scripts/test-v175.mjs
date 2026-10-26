/**
 * v1.7.0 build 4 — XSS escape audit (Master Plan item 12).
 *
 * Two layers:
 *
 * 1. STATIC GATE — the internal-page architecture is XSS-safe by
 *    construction: DOM via createElement + textContent, navigation via the
 *    IPC bridge, React in the chrome shell (auto-escaping). This gate makes
 *    that construction permanent: any future `innerHTML = <something>`,
 *    document.write, insertAdjacentHTML, eval/new Function, or
 *    dangerouslySetInnerHTML FAILS this suite before it ships.
 *
 * 2. RUNTIME PROOF — the new-tab page is booted in JSDOM with a bridge
 *    stubbed to return HOSTILE data (script tags, img-onerror,
 *    javascript: URLs in hosts/titles/urls). We assert the payloads render
 *    as inert text and nothing executes.
 *
 * Run:  node scripts/test-v175.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

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

/* ---------- bundle pages.ts (same stubs as test-v172) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test175-'))
fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })
fs.writeFileSync(
  path.join(tmp, 'src', 'main', 'store.ts'),
  `import { normalizeAppearance } from './appearance'
   export function mergedSettings() { return { appearance: normalizeAppearance({}) } }`
)
const nm = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(nm, { recursive: true })
fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }))
fs.writeFileSync(
  path.join(nm, 'index.js'),
  `module.exports = { app: { getVersion: () => '9.9.9' }, nativeTheme: { shouldUseDarkColors: true } }`
)
const entry = path.join(tmp, 'src', 'main', 'testable-v175.ts')
fs.writeFileSync(entry, `export { NEW_TAB_HTML } from './pages'`)

const OUTDIR = path.join(APP, '.test-v175-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['jsdom'],
  outfile: path.join(OUTDIR, 'bundle.mjs'),
  logLevel: 'silent'
})
const { NEW_TAB_HTML } = await import(pathToFileURL(path.join(OUTDIR, 'bundle.mjs')).href)

/* ================= 1. static gate — pages.ts ================= */
console.log('\n[1] static gate — internal pages keep the XSS-safe architecture')
{
  const src = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf8')
  // every innerHTML sink must be the clear-container pattern — with exactly
  // ONE audited exception (v2.5.0): the READER page renders the article HTML
  // that main/reader.ts sanitizeArticleElement() whitelisted (tag + attribute
  // allowlist, no javascript:/data:, CSP nonce as the second line of defense;
  // 13 sanitizer assertions live in test-v250).
  const sinks = [...src.matchAll(/\.innerHTML\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim())
  ok(sinks.length >= 15, `innerHTML sinks found (${sinks.length})`)
  const violators = sinks.filter((s) => s !== "''" && s !== "a.content || ''")
  ok(sinks.filter((s) => s === "a.content || ''").length === 1, 'exactly one reader article sink (sanitized upstream)')
  ok(violators.length === 0, `every other innerHTML assignment is the '' clear (${violators.length} violators)`)
  ok(!/document\.write(ln)?\(/.test(src), 'no document.write/writeln')
  ok(!/insertAdjacentHTML/.test(src), 'no insertAdjacentHTML')
  ok(!/\.outerHTML\s*=/.test(src), 'no outerHTML assignment')
  ok(!/\beval\(/.test(src), 'no eval()')
  ok(!/new\s+Function\(/.test(src), 'no new Function()')
  ok(!/javascript:/i.test(src), 'no javascript: URLs')
  ok(/textContent/.test(src), 'DOM text goes through textContent')
  ok(/addEventListener\(/.test(src) && !/\son(click|error|load)=/.test(src), 'events via addEventListener — no inline handlers')
}

/* ================= 2. static gate — renderer + agent ================= */
console.log('\n[2] static gate — React chrome + agent serializer')
{
  const scans = [
    ['src/renderer/src', /dangerouslySetInnerHTML/],
    ['src/main/agent', /innerHTML\s*=\s*(?!'')/],
    ['src/main/agent', /document\.write/]
  ]
  let dirty = []
  for (const [dir, rx] of scans) {
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name)
        if (f.isDirectory()) walk(p)
        else if (/\.(tsx?|jsx?)$/.test(f.name)) {
          if (rx.test(fs.readFileSync(p, 'utf8'))) dirty.push(p)
        }
      }
    }
    walk(path.join(APP, dir))
  }
  ok(dirty.length === 0, `no dangerous sinks in renderer/agent (${dirty.length} files flagged)`)
}

/* ================= 3. runtime proof — hostile data into the new tab ================= */
console.log('\n[3] runtime — hostile payloads injected through the startup bridge')
{
  const EVIL = [
    { host: '<img src=x onerror="window.__pwned1=1">', url: 'javascript:window.__pwned3=1', title: 'evil site' },
    { host: 'ok.example', url: 'https://ok.example', title: '<script>window.__pwned2=1<\/script>' }
  ]
  const EVIL_BM = [{ title: '<svg onload="window.__pwned4=1">', url: 'https://ok.example' }]

  let bridgeCalls = 0
  const dom = new JSDOM(NEW_TAB_HTML, {
    runScripts: 'dangerously',
    url: 'aether://newtab',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.__pwned = undefined
      window.aether = {
        internal: {
          startup: async () => {
            bridgeCalls++
            return { topSites: EVIL, bookmarks: EVIL_BM }
          },
          open: async () => {},
          search: async () => {}
        },
        settings: { get: async () => ({ appearance: {} }) }
      }
      window.__jsErrors = []
      window.addEventListener('error', (e) => window.__jsErrors.push(String(e.message)))
    }
  })

  await new Promise((r) => setTimeout(r, 300)) // let startup + render settle

  const doc = dom.window.document
  ok(bridgeCalls === 1, 'startup bridge called once')
  for (const k of ['__pwned1', '__pwned2', '__pwned3', '__pwned4']) {
    ok(dom.window[k] === undefined, `${k} never executed`)
  }
  ok(doc.querySelectorAll('script').length === 1, `exactly the page's own script remains (${doc.querySelectorAll('script').length})`)
  ok(doc.querySelectorAll('img[onerror]').length === 0, 'no img[onerror] parsed into live attribute')
  ok(doc.querySelectorAll('svg[onload]').length === 0, 'no svg[onload] parsed into live attribute')
  // the payload must appear as literal TEXT in the rendered card
  const topText = doc.getElementById('top')?.textContent || ''
  ok(topText.includes('<img src=x'), 'hostile host rendered as inert text')
  const bmText = doc.getElementById('bm')?.textContent || ''
  ok(bmText.includes('<svg'), 'hostile bookmark title rendered as inert text')
  ok((dom.window.__jsErrors || []).length === 0, `page threw no errors (${JSON.stringify(dom.window.__jsErrors)})`)
  dom.window.close()
}

fs.rmSync(OUTDIR, { recursive: true, force: true })

console.log(`\nv1.7.0 build 4 (XSS escape audit): ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
