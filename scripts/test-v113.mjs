/**
 * v1.1.3 unit tests — resilient multi-engine web search.
 *
 * Covers: DDG anomaly-page (HTTP 202) fallthrough, DDG Lite fallback,
 * Bing HTML parsing (base64url ck/a unwrapping + direct links),
 * all-engines-failed error, googleSearchUrl, and resolveInput regression.
 *
 * Run:  node scripts/test-v113.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

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

/* ---------- build a runnable bundle with electron stubbed ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test113-'))
const nm = path.join(tmp, 'node_modules')
const stubDir = path.join(nm, 'electron')
fs.mkdirSync(stubDir, { recursive: true })
fs.writeFileSync(
  path.join(stubDir, 'index.js'),
  `module.exports = {
     app: { getPath: () => '${tmp.replace(/\\/g, '/')}/userdata', isPackaged: false, getVersion: () => '1.1.3' },
     session: { defaultSession: {} },
     BrowserWindow: class {},
     WebContentsView: class {},
     shell: {},
     DownloadItem: class {}
   }`
)
fs.writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }))

/* search.ts imports jsdom — symlink the real one so the tmp bundle can resolve it */
fs.symlinkSync(path.join(APP, 'node_modules', 'jsdom'), path.join(nm, 'jsdom'), 'dir')

fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

const entry = path.join(tmp, 'src', 'main', 'testable.ts')
fs.writeFileSync(
  entry,
  `export { webSearch, googleSearchUrl } from './search'
   export { resolveInput } from './resolve'`
)

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['jsdom', 'turndown', '@mozilla/readability'],
  outfile: path.join(tmp, 'bundle.mjs'),
  logLevel: 'silent'
})

const B = await import(pathToFileURL(path.join(tmp, 'bundle.mjs')).href)

/* ---------- fixtures ---------- */
const ANOMALY_PAGE = '<html><body><div>Anomaly detected</div></body></html>'
const b64u = (s) => Buffer.from(s).toString('base64url')

const DDG_GOOD = `
  <div class="result">
    <a class="result__a" href="https://html.duckduckgo.com/l/?uddg=${encodeURIComponent('https://example.com/ddg')}">Example DDG</a>
    <div class="result__snippet">DuckDuckGo snippet text</div>
  </div>`

const LITE_GOOD = `
  <table>
    <tr><td><a class="result-link" href="https://lite.duckduckgo.com/l/?uddg=${encodeURIComponent('https://example.com/lite')}">Lite Result</a></td></tr>
    <tr><td class="result-snippet">Lite snippet text</td></tr>
  </table>`

const BING_GOOD = `
  <ol>
    <li class="b_algo">
      <h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=xyz&amp;u=a1${b64u('https://example.com/bing')}&amp;ntb=1"><strong>Example Bing</strong> Title</a></h2>
      <div class="b_caption"><p class="b_lineclamp2">Bing snippet text that is long enough for the parser</p></div>
    </li>
    <li class="b_algo">
      <h2><a href="https://direct.example.com/page">Direct Link Result</a></h2>
      <p>Another snippet that is also long enough to be picked up</p>
    </li>
  </ol>`

const realFetch = globalThis.fetch
function stubFetch(handler) {
  globalThis.fetch = async (url) => handler(String(url))
}
const callsOf = (arr) => arr

/* ---------- 1. DDG anomaly (202-style empty page) falls through to Bing ---------- */
{
  const calls = []
  stubFetch((url) => {
    calls.push(url)
    if (url.includes('html.duckduckgo.com')) return { ok: true, status: 202, text: async () => ANOMALY_PAGE }
    if (url.includes('lite.duckduckgo.com')) return { ok: true, status: 202, text: async () => ANOMALY_PAGE }
    if (url.includes('bing.com')) return { ok: true, status: 200, text: async () => BING_GOOD }
    throw new Error('unexpected engine ' + url)
  })
  const results = await B.webSearch('nodejs tutorial')
  ok(results.length === 2, `Bing fallback returns 2 results after DDG anomaly pages (got ${results.length})`)
  ok(results[0].url === 'https://example.com/bing', `Bing ck/a base64url link unwrapped (${results[0]?.url})`)
  ok(results[0].title.includes('Example Bing'), 'Bing title parsed')
  ok(results[0].snippet.includes('Bing snippet'), 'Bing snippet parsed')
  ok(results[1].url === 'https://direct.example.com/page', `Bing direct (non-wrapped) link passes through (${results[1]?.url})`)
  ok(callsOf(calls).length === 3, `tried all three engines in order (${calls.length} calls)`)
  ok(calls[0].includes('html.duckduckgo.com') && calls[1].includes('lite.duckduckgo.com') && calls[2].includes('bing.com'), 'engine order: DDG → DDG Lite → Bing')
}

/* ---------- 2. DDG healthy → used directly, no later engine contacted ---------- */
{
  const calls = []
  stubFetch((url) => {
    calls.push(url)
    if (url.includes('html.duckduckgo.com')) return { ok: true, status: 200, text: async () => DDG_GOOD }
    throw new Error('should not reach later engines')
  })
  const results = await B.webSearch('hello world')
  ok(results.length === 1 && results[0].url === 'https://example.com/ddg', 'DDG primary results parsed and unwrapped')
  ok(calls.length === 1, 'no fallback calls when the primary engine works')
}

/* ---------- 3. DDG HTML down → Lite fallback ---------- */
{
  stubFetch((url) => {
    if (url.includes('html.duckduckgo.com')) throw new Error('net down')
    if (url.includes('lite.duckduckgo.com')) return { ok: true, status: 200, text: async () => LITE_GOOD }
    throw new Error('should not reach Bing')
  })
  const results = await B.webSearch('fallback test')
  ok(results.length === 1 && results[0].url === 'https://example.com/lite' && results[0].snippet.includes('Lite snippet'), 'DDG Lite fallback parsed')
}

/* ---------- 4. every engine fails → descriptive error ---------- */
{
  stubFetch(() => {
    throw new Error('offline')
  })
  let threw = ''
  try {
    await B.webSearch('no network')
  } catch (err) {
    threw = String(err && err.message)
  }
  ok(threw.includes('all search engines failed'), 'all-fail path throws a descriptive error')
  ok(threw.includes('DuckDuckGo') && threw.includes('Bing'), `error names the engines (${threw.slice(0, 80)}…)`)
}

/* ---------- 5. HTTP error statuses fall through, not crash ---------- */
{
  stubFetch(() => ({ ok: false, status: 429, text: async () => '' }))
  let threw = ''
  try {
    await B.webSearch('rate limited')
  } catch (err) {
    threw = String(err && err.message)
  }
  ok(threw.includes('HTTP 429'), 'non-2xx statuses recorded per engine')
}

/* ---------- 6. empty query short-circuits ---------- */
{
  let called = false
  stubFetch(() => {
    called = true
    return { ok: true, status: 200, text: async () => DDG_GOOD }
  })
  const results = await B.webSearch('   ')
  ok(results.length === 0 && !called, 'empty query returns [] without any network call')
}

/* ---------- 7. googleSearchUrl ---------- */
{
  ok(B.googleSearchUrl('hello world') === 'https://www.google.com/search?q=hello%20world', 'googleSearchUrl encodes the query')
  ok(B.googleSearchUrl('  x  ') === 'https://www.google.com/search?q=x', 'googleSearchUrl trims the query')
}

/* ---------- 8. resolveInput regression (search routing unchanged) ---------- */
{
  ok(B.resolveInput('what is node js') === 'aether://search?q=what%20is%20node%20js', 'plain words route to the AI search page (default mode)')
  ok(B.resolveInput('example.com') === 'https://example.com', 'domain-ish input opens the site directly')
  ok(B.resolveInput('https://youtube.com/watch?v=1') === 'https://youtube.com/watch?v=1', 'explicit URLs pass through')
}

/* ---------- restore + report ---------- */
globalThis.fetch = realFetch
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
