/**
 * v1.3.0 Aether Search tests — the metasearch layer.
 *
 * Covers: URL normalization + tracking-param strip, tokenization, scoring,
 * dedupe + round-robin aggregation (deterministic), the safe arithmetic
 * evaluator behind instant answers, DDG-ac parsing, suggestion merging,
 * and the parallel searchAll pipeline with an INJECTED fetcher (no network).
 *
 * Run:  node scripts/test-v130.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test130-'))

function stubModule(name, code) {
  const dir = path.join(tmp, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.js'), code)
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
}

stubModule('electron', `module.exports = { app: { getPath: () => '${tmp.replace(/\\/g, '/')}/userdata' } }`)
fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

const entry = path.join(tmp, 'src', 'main', 'testable.ts')
fs.writeFileSync(
  entry,
  `export {
     normalizeUrl, tokenize, scoreResult, aggregate, aggregateRanked,
     evaluateMath, instantAnswer, parseAcResponse, mergeSuggestions, searchAll
   } from './search-engine'`
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
const {
  normalizeUrl, tokenize, scoreResult, aggregate, aggregateRanked,
  evaluateMath, instantAnswer, parseAcResponse, mergeSuggestions, searchAll
} = B

/* ================= 1. normalizeUrl ================= */
console.log('\n[1] URL normalization + tracking strip')
{
  ok(
    normalizeUrl('https://example.com/a/?utm_source=x&utm_medium=y&id=9') === 'https://example.com/a?id=9',
    'utm_* parameters are stripped, real ones kept'
  )
  ok(
    normalizeUrl('http://example.com/page/#section') === 'https://example.com/page',
    'http upgraded to https, fragment dropped, trailing slash trimmed'
  )
  ok(normalizeUrl('http://localhost:5173/x') === 'http://localhost:5173/x', 'localhost keeps http')
  ok(
    normalizeUrl('https://example.com/?b=2&a=1') === 'https://example.com/?a=1&b=2',
    'query params sorted for deterministic comparison'
  )
  ok(normalizeUrl('not a url at all') === 'not a url at all', 'garbage input passes through unchanged')
  ok(
    normalizeUrl('https://EXAMPLE.com/A/') === 'https://example.com/A',
    'host lowercased, trailing slash trimmed'
  )
}

/* ================= 2. tokenize + scoreResult ================= */
console.log('\n[2] tokenize + scoreResult')
{
  ok(JSON.stringify(tokenize('How to Build a BROWSER fast?')) === JSON.stringify(['how', 'to', 'build', 'browser', 'fast']),
    'lowercase word tokens, len>=2, punctuation ignored, deduped')
  ok(JSON.stringify(tokenize('  a I  ')) === '[]', 'single chars and empty input produce no tokens')

  const qt = tokenize('electron browser')
  ok(scoreResult({ title: 'Electron Browser docs', url: 'https://e.com', snippet: '' }, qt) >= 6,
    'title hits both tokens -> high score')
  const a = scoreResult({ title: 'Electron Browser docs', url: 'https://e.com', snippet: 'x'.repeat(50) }, qt)
  const b = scoreResult({ title: 'Something else', url: 'https://e.com', snippet: 'electron browser here' }, qt)
  ok(a > b, 'title match outranks snippet-only match')
  ok(scoreResult({ title: 't', url: 'ftp://x', snippet: '' }, qt) < scoreResult({ title: 't', url: 'https://x', snippet: '' }, qt),
    'https URLs score above non-http schemes')
}

/* ================= 3. aggregate — dedupe + interleave ================= */
console.log('\n[3] aggregate — dedupe + round-robin interleave')
{
  const per = [
    {
      source: 'A',
      results: [
        { title: 'a1', url: 'https://x.com/1', snippet: '' },
        { title: 'a2', url: 'https://x.com/2', snippet: '' },
        { title: 'a3', url: 'https://x.com/3', snippet: '' }
      ]
    },
    {
      source: 'B',
      results: [
        { title: 'b1 dup of a1', url: 'https://x.com/1?utm_source=spmy', snippet: '' },
        { title: 'b2', url: 'https://y.com/2', snippet: '' }
      ]
    }
  ]
  const agg = aggregate(per, 12)
  ok(agg.length === 4, 'duplicate URL (tracking-param only difference) is deduped away')
  ok(agg[0].title === 'a1' && agg[0].source === 'A', 'first source keeps the badge for the duplicate')
  ok(agg[1].title === 'b2' && agg[1].source === 'B', 'round-robin: second slot comes from source B')
  ok(agg[2].title === 'a2' && agg[3].title === 'a3', 'interleave continues lane A then B is exhausted')
  const capped = aggregate(per, 2)
  ok(capped.length === 2, 'cap n respected')
  const empty = aggregate([{ source: 'A', results: [] }], 12)
  ok(empty.length === 0, 'no sources with results -> empty aggregate')
}

/* ================= 4. aggregateRanked — deterministic ranking ================= */
console.log('\n[4] aggregateRanked — score-sorted lanes, stable ties')
{
  const per = [
    {
      source: 'A',
      results: [
        { title: 'no match at all', url: 'https://a.com/1', snippet: '' },
        { title: 'electron guide', url: 'https://a.com/2', snippet: '' }
      ]
    },
    {
      source: 'B',
      results: [{ title: 'electron tutorial', url: 'https://b.com/1', snippet: 'electron' }]
    }
  ]
  const r1 = aggregateRanked(per, 'electron', 12)
  ok(r1[0].url === 'https://a.com/2', 'best A-lane result (title hit) surfaces first for lane A')
  ok(r1[0].url === aggregateRanked(per, 'electron', 12)[0].url, 'deterministic: identical input, identical output')
  ok(r1.every((x) => x.source), 'every aggregated result carries a source badge')
}

/* ================= 5. evaluateMath — the safe calculator ================= */
console.log('\n[5] evaluateMath — safe arithmetic (no eval)')
{
  ok(evaluateMath('2+3*4') === 14, 'precedence: 2+3*4 = 14')
  ok(evaluateMath('(2+3)*4') === 20, 'parentheses override precedence')
  ok(evaluateMath('2^3^2') === 512, 'power is right-associative: 2^3^2 = 512')
  ok(evaluateMath('-5+3') === -2, 'unary minus')
  ok(evaluateMath('10%3') === 1, 'modulo')
  ok(Math.abs(evaluateMath('sqrt(16)') - 4) < 1e-12, 'sqrt function')
  ok(Math.abs(evaluateMath('pi*2') - Math.PI * 2) < 1e-12, 'pi constant')
  ok(evaluateMath('10/4') === 2.5, 'division')
  ok(evaluateMath('123') === null, 'bare number is not an expression')
  ok(evaluateMath('') === null, 'empty input rejected')
  ok(evaluateMath('2+abc') === null, 'unknown identifiers rejected')
  ok(evaluateMath('eval(1)') === null, 'eval is not a known function -> null (no code execution)')
  ok(evaluateMath('9^9^9') === null, 'overflow to Infinity -> null')
  ok(evaluateMath('2+3 x') === null, 'trailing garbage rejected (full-consumption check)')
  ok(evaluateMath('(2+3') === null, 'unbalanced paren rejected')
  ok(evaluateMath('x'.repeat(150) + '+1') === null, 'over-long input rejected by length cap')
  ok(evaluateMath('process.exit(1)') === null, 'hostile-looking input is just null')
}

/* ================= 6. instantAnswer ================= */
console.log('\n[6] instantAnswer')
{
  ok(instantAnswer('2+2')?.output === '4', 'plain arithmetic answers instantly')
  ok(instantAnswer('what is 12*12')?.output === '144', 'natural prefix (what is) stripped')
  ok(instantAnswer('237*1.5 =')?.output === '355.5', 'trailing = stripped, decimals work')
  ok(instantAnswer('(3+2)*4?')?.output === '20', 'trailing ? stripped, parens work')
  ok(instantAnswer('hello world') === null, 'non-math queries -> null')
  ok(instantAnswer('youtube') === null, 'plain word -> null')
  ok(instantAnswer('') === null, 'empty -> null')
  ok(instantAnswer('10000000000*10000000000')?.output === '100000000000000000000', 'large finite results stay exact (Infinity -> null, tested below)')
}

/* ================= 7. parseAcResponse ================= */
console.log('\n[7] DDG ac response parsing')
{
  ok(JSON.stringify(parseAcResponse('["yo",["youtube","youtube downloader"]]')) ===
     JSON.stringify(['youtube', 'youtube downloader']), 'list-shape parsed')
  ok(JSON.stringify(parseAcResponse('[{"phrase":"news"},{"phrase":"weather"}]')) ===
     JSON.stringify(['news', 'weather']), 'phrase-shape parsed')
  ok(parseAcResponse('not json').length === 0, 'garbage -> empty')
  ok(parseAcResponse('[]').length === 0, 'empty array -> empty')
  ok(parseAcResponse('{"a":1}').length === 0, 'object shape -> empty (never throws)')
}

/* ================= 8. mergeSuggestions ================= */
console.log('\n[8] suggestion merging')
{
  const m = mergeSuggestions(['YouTube', 'youtube docs'], ['YOUTUBE', 'youtube music', 'youtube live'], 8)
  ok(m[0] === 'YouTube' && m[1] === 'youtube docs', 'local history/bookmark matches come first')
  ok(!m.includes('YOUTUBE'), 'case-insensitive dedupe against local entries')
  ok(m.length === 4 && m.includes('youtube music'), 'remote suggestions fill the rest in order')
  ok(mergeSuggestions([], ['a', 'b'], 1).length === 1, 'cap n enforced')
  ok(mergeSuggestions(['  ', ''], [], 8).length === 0, 'blank entries dropped')
}

/* ================= 9. searchAll — the parallel pipeline ================= */
console.log('\n[9] searchAll — parallel aggregation with injected fetcher')
{
  const results = await searchAll(
    'electron browser',
    async (src) =>
      src === 'A'
        ? [{ title: 'electron from A', url: 'https://a.com/1', snippet: 'electron browser' }]
        : [
            { title: 'electron from B', url: 'https://b.com/1', snippet: 'electron' },
            { title: 'same as A', url: 'https://a.com/1', snippet: 'dup' }
          ],
    ['A', 'B']
  )
  ok(results.aggregated.length === 2, 'cross-source duplicate removed in the real pipeline')
  ok(results.aggregated[0].source === 'A', 'higher-scored lane entry wins slot 1')
  ok(results.stats.length === 2 && results.stats.find((s) => s.source === 'A').count === 1 &&
     results.stats.find((s) => s.source === 'B').count === 2 && results.stats.every((s) => typeof s.ms === 'number'),
    'per-source stats: RAW counts + timing reported')

  const partial = await searchAll(
    'q',
    async (src) => {
      if (src === 'Bad') throw new Error('HTTP 202')
      return [{ title: 'ok', url: 'https://ok.com', snippet: '' }]
    },
    ['Bad', 'Good']
  )
  ok(partial.aggregated.length === 1, 'one failed source does not sink the pipeline')
  ok(partial.stats.find((s) => s.source === 'Bad').error === 'HTTP 202', 'failure message is carried in stats (source is the key)')

  let allFailed = null
  try {
    await searchAll('q', async () => { throw new Error('offline') }, ['X', 'Y'])
  } catch (err) {
    allFailed = err
  }
  ok(allFailed && /all search engines failed \(X: offline \| Y: offline\)/.test(allFailed.message),
    'all-fail error lists every source failure (same contract as the old chain)')

  const emptyQ = await searchAll('   ', async () => [{ title: 'x', url: 'https://x', snippet: '' }], ['A'])
  ok(emptyQ.aggregated.length === 0 && emptyQ.stats.length === 0, 'blank query short-circuits to empty')
}

/* ================= done ================= */
console.log(`\nv1.3.0 Aether Search: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
