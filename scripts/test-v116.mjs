/**
 * v1.1.6 unit tests — load-failure mapping (the blank-page fix).
 *
 * Regression: main-frame load failures (network down, DNS blocked, ad blocker
 * cancelling the document, page crash) only renamed the tab title and logged
 * to the console — the user stared at an infinite blank view. Failures now
 * navigate to aether://error?… while the omnibox keeps the original URL.
 *
 * Run:  node scripts/test-v116.mjs
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

/* ---------- build a runnable bundle (errmap.ts is pure — no electron) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test116-'))
fs.mkdirSync(path.join(tmp, 'src', 'main'), { recursive: true })
fs.copyFileSync(path.join(APP, 'src', 'main', 'errmap.ts'), path.join(tmp, 'src', 'main', 'errmap.ts'))
const entry = path.join(tmp, 'src', 'testable.ts')
fs.writeFileSync(
  entry,
  `export { shouldShowErrorPage, errorPageUrl, originalUrlFromErrorPage, isErrorPageUrl, CRASH_CODE } from './main/errmap'`
)

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(tmp, 'bundle.mjs'),
  logLevel: 'silent'
})

const B = await import(pathToFileURL(path.join(tmp, 'bundle.mjs')).href)
const { shouldShowErrorPage, errorPageUrl, originalUrlFromErrorPage, isErrorPageUrl, CRASH_CODE } = B

/* ---------- 1. shouldShowErrorPage ---------- */
ok(shouldShowErrorPage(-105, true) === true, 'DNS failure on main frame shows the error page')
ok(shouldShowErrorPage(-102, true) === true, 'connection refused on main frame shows the error page')
ok(shouldShowErrorPage(-20, true) === true, 'ERR_BLOCKED_BY_CLIENT (ad blocker) shows the error page')
ok(shouldShowErrorPage(-118, true) === true, 'connection timeout shows the error page')
ok(shouldShowErrorPage(-3, true) === false, 'ERR_ABORTED (superseded navigation) is NOT an error')
ok(shouldShowErrorPage(0, true) === false, 'code 0 is NOT an error')
ok(shouldShowErrorPage(-105, false) === false, 'subframe failures never replace the page')
ok(shouldShowErrorPage(-3, false) === false, 'aborted subframe never replaces the page')

/* ---------- 2. errorPageUrl ---------- */
const ep = errorPageUrl('https://www.youtube.com/', -118, 'ERR_CONNECTION_TIMED_OUT')
ok(ep.startsWith('aether://error?'), 'error URL uses the aether://error scheme')
ok(ep.includes('u=https%3A%2F%2Fwww.youtube.com%2F'), 'original URL is carried encoded')
ok(ep.includes('c=-118'), 'error code is carried')
ok(ep.includes('d=ERR_CONNECTION_TIMED_OUT'), 'error description is carried')
const epWeird = errorPageUrl('https://x.com/a?b=1&c=2#frag', -20, 'net::ERR_BLOCKED_BY_CLIENT & "reason"')
ok(originalUrlFromErrorPage(epWeird) === 'https://x.com/a?b=1&c=2#frag', 'URLs with &?# round-trip')
ok(originalUrlFromErrorPage(errorPageUrl('', -2, 'x')) === '', 'empty original URL round-trips')
ok(errorPageUrl('aether://error?u=abc&c=-1', -5, 'again') === 'aether://error?u=abc&c=-1',
  'error page URLs are never re-wrapped (no recursive error pages)')

/* ---------- 3. originalUrlFromErrorPage ---------- */
ok(originalUrlFromErrorPage('https://example.com/page') === 'https://example.com/page',
  'normal URLs pass through unchanged (omnibox stays honest)')
ok(originalUrlFromErrorPage('') === '', 'empty string passes through')
ok(originalUrlFromErrorPage('aether://error?u=https%3A%2F%2Fyoutube.com%2F&c=-105&d=DNS') === 'https://youtube.com/',
  'error page maps back to the requested site')
ok(originalUrlFromErrorPage('aether://error?c=-105') === '', 'error page without u maps to empty')

/* ---------- 4. isErrorPageUrl (incl. Chromium's normalized form) ---------- */
ok(isErrorPageUrl('aether://error?u=x') === true, 'isErrorPageUrl detects error pages')
ok(isErrorPageUrl('aether://error/?u=x') === true, 'isErrorPageUrl detects Chromium-normalized error pages (slash path)')
ok(isErrorPageUrl('aether://newtab') === false, 'isErrorPageUrl passes other internal pages')
ok(isErrorPageUrl('https://aether://error?fake') === false, 'isErrorPageUrl is scheme-anchored')
ok(isErrorPageUrl('aether://errorpage?u=x') === false, 'scheme-anchored: no hostname prefix matches')
ok(isErrorPageUrl(null) === false, 'isErrorPageUrl survives null')
ok(originalUrlFromErrorPage('aether://error/?u=https%3A%2F%2Fyoutube.com%2F&c=-312&d=ERR_UNSAFE_PORT') === 'https://youtube.com/',
  'normalized error URL maps back to the requested site')
ok(errorPageUrl('aether://error/?u=abc', -5, 'x') === 'aether://error/?u=abc',
  'normalized error URLs are never re-wrapped')

/* ---------- 5. crash sentinel ---------- */
ok(CRASH_CODE === -1000, 'CRASH_CODE sentinel is -1000 (render-process-gone path)')

console.log(`\nv1.1.6 error-mapping tests: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
