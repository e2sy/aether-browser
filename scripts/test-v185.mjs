/**
 * v2.0 build 14 — Phase 4 AI: TL;DR (#72), semantic history (#73),
 * depth modes (#78), VRAM calculator (#79), pledge page (#81).
 *
 * Run:  node scripts/test-v185.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test185-'))
async function bundleShared(relSrc, outName) {
  const stage = path.join(tmp, path.basename(outName, '.mjs'))
  fs.mkdirSync(stage, { recursive: true })
  fs.cpSync(path.join(APP, 'src', relSrc), path.join(stage, path.basename(relSrc)))
  const OUTDIR = path.join(APP, `.test-v185-${path.basename(outName, '.mjs')}`)
  fs.rmSync(OUTDIR, { recursive: true, force: true })
  fs.mkdirSync(OUTDIR, { recursive: true })
  await build({ entryPoints: [path.join(stage, path.basename(relSrc))], bundle: true, platform: 'node', format: 'esm', outfile: path.join(OUTDIR, outName), logLevel: 'silent' })
  return import(pathToFileURL(path.join(OUTDIR, outName)).href)
}
async function bundleMain(srcFile, outName) {
  const stage = path.join(tmp, path.basename(outName, '.mjs'))
  fs.mkdirSync(stage, { recursive: true })
  fs.cpSync(path.join(APP, 'src', 'main', srcFile), path.join(stage, path.basename(srcFile)))
  const nm = path.join(tmp, 'node_modules', 'electron')
  fs.mkdirSync(nm, { recursive: true })
  fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }))
  fs.writeFileSync(path.join(nm, 'index.js'), `module.exports = { app: { getPath: () => ${JSON.stringify(path.join(tmp, 'ud'))} } }`)
  fs.writeFileSync(path.join(stage, 'store.ts'), `export class JsonStore { constructor(_n, d) { this.data = d } save() {} }\nexport function recentHistory(_n) { return [] }\n`)
  const OUTDIR = path.join(APP, `.test-v185-${path.basename(outName, '.mjs')}`)
  fs.rmSync(OUTDIR, { recursive: true, force: true })
  fs.mkdirSync(OUTDIR, { recursive: true })
  await build({ entryPoints: [path.join(stage, path.basename(srcFile))], bundle: true, platform: 'node', format: 'esm', outfile: path.join(OUTDIR, outName), logLevel: 'silent' })
  return import(pathToFileURL(path.join(OUTDIR, outName)).href)
}

const dep = await bundleMain('depth.ts', 'depth.mjs')
const vr = await bundleShared('shared/vram.ts', 'vram.mjs')
const sem = await bundleMain('semhistory.ts', 'semhistory.mjs')

async function bundleTldr() {
  const stage = path.join(tmp, 'tldr')
  fs.mkdirSync(stage, { recursive: true })
  fs.cpSync(path.join(APP, 'src', 'main', 'tldr.ts'), path.join(stage, 'tldr.ts'))
  fs.writeFileSync(path.join(stage, 'store.ts'), `export function mergedSettings() { return {} }\n`)
  fs.writeFileSync(path.join(stage, 'brain.ts'), `export function brainError(_e) { return '' }\nexport async function resolveBrain() { return null }\n`)
  fs.writeFileSync(path.join(stage, 'ollama.ts'), `export async function chatOnce(_m, _msgs) { return { message: { content: '' } } }\n`)
  const OUTDIR = path.join(APP, '.test-v185-tldr')
  fs.rmSync(OUTDIR, { recursive: true, force: true })
  fs.mkdirSync(OUTDIR, { recursive: true })
  await build({ entryPoints: [path.join(stage, 'tldr.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(OUTDIR, 'tldr.mjs'), logLevel: 'silent' })
  return import(pathToFileURL(path.join(OUTDIR, 'tldr.mjs')).href)
}
const tldrpure = await bundleTldr()

console.log('\n── search depth modes (#78) ──')
ok(dep.isSearchDepth('deep') && dep.isSearchDepth('code') && !dep.isSearchDepth('fast'), 'depth validation')
eq(dep.depthSourceCount('quick'), 6, 'quick → 6 sources')
ok(dep.depthSourceCount('deep') > dep.depthSourceCount('quick'), 'deep uses more sources')
ok(dep.depthPrompt('deep').includes('synthesize'), 'deep prompt shapes synthesis')
ok(dep.depthPrompt('academic').includes('.edu'), 'academic prompt prefers edu/gov')
ok(dep.depthPrompt('code').includes('Stack Overflow') || dep.depthPrompt('code').includes('docs'), 'code prompt prefers dev sources')
eq(dep.depthPrompt('quick'), '', 'quick = base prompt only')
eq(dep.depthBoost('academic', 'https://arxiv.org/abs/123'), 2, 'academic boosts arxiv')
eq(dep.depthBoost('code', 'https://github.com/x/y/issues/1'), 2, 'code boosts github')
eq(dep.depthBoost('code', 'https://random.example/x'), 0, 'no boost for unlisted hosts')
eq(dep.depthBoost('quick', 'https://github.com/x'), 0, 'quick has no boosts')

console.log('\n── VRAM calculator (#79) ──')
const e8bq4 = vr.estimateVram({ paramsB: 8, quantBits: 4, ctxTokens: 8192 })
const e8bq8 = vr.estimateVram({ paramsB: 8, quantBits: 8, ctxTokens: 8192 })
const e70bq4 = vr.estimateVram({ paramsB: 70, quantBits: 4, ctxTokens: 8192 })
ok(e8bq4.totalGB > e8bq4.weightsGB, 'total = weights + kv + overhead')
ok(e8bq8.totalGB > e8bq4.totalGB, 'higher quant → more VRAM')
ok(e70bq4.totalGB > 35, '70B q4 needs >35GB (honest about big models)')
ok(e8bq4.totalGB < 8, '8B q4 fits under 8GB')
eq(vr.estimateVram({ paramsB: -5, quantBits: 4 }).totalGB, 0.6, 'garbage params → overhead only')
eq(vr.estimateVram({ paramsB: 8, quantBits: 99 }).weightsGB, 8 * 0.55, 'unknown quant falls back to 4-bit')
eq(vr.paramsFromModelName('qwen3.5:9b-instruct-q4_K_M'), 9, 'parses 9b from model name')
eq(vr.paramsFromModelName('llama3.1-70b'), 70, 'parses 70b with dash')
eq(vr.paramsFromModelName('nomic-embed-text'), null, 'no size hint → null')
eq(vr.quantFromModelName('llama3-8b-q4_K_M'), 4, 'parses q4 quant tag')
eq(vr.quantFromModelName('model-q8_0'), 8, 'parses q8')
eq(vr.quantFromModelName('no-quant-here'), null, 'no quant → null')

console.log('\n── semantic history core (#73) ──')
eq(sem.cosineSim([1, 0], [1, 0]), 1, 'identical vectors = 1')
eq(sem.cosineSim([1, 0], [0, 1]), 0, 'orthogonal = 0')
ok(Math.abs(sem.cosineSim([1, 1], [1, 0]) - 0.7071) < 0.001, '45° ≈ 0.707')
eq(sem.cosineSim([], []), 0, 'empty vectors fail safe')
eq(sem.cosineSim([1, 2], [1, 2, 3]), 0, 'length mismatch fails safe')
const items = [
  { vec: [1, 0], url: 'a' },
  { vec: [0.9, 0.1], url: 'b' },
  { vec: [0, 1], url: 'c' }
]
const tops = sem.topK(items, [1, 0], 2)
eq(tops.map((t) => t.item.url), ['a', 'b'], 'topK orders by similarity')
eq(tops.length, 2, 'topK respects k')
ok(sem.itemText({ url: 'https://x.com/a', title: 'Big article', host: 'x.com', ts: 1 }).includes('Big article'), 'item text uses title+host')

console.log('\n── TL;DR host matching (#72) ──')
eq(tldrpure.hostMatchesTldr('en.wikipedia.org', ['en.wikipedia.org']), true, 'exact match')
eq(tldrpure.hostMatchesTldr('www.en.wikipedia.org', ['en.wikipedia.org']), true, 'www stripped on both sides')
eq(tldrpure.hostMatchesTldr('en.wikipedia.org', []), false, 'empty list = off')
eq(tldrpure.hostMatchesTldr('en.wikipedia.org', ' wikipedia '), false, 'non-array list = off')
eq(tldrpure.hostMatchesTldr('', ['a.com']), false, 'empty host = no match')
ok(tldrpure.TLDR_SYSTEM.includes('3 short bullets'), 'TL;DR prompt pins the 3-bullet shape')

console.log('\n── wiring — search, pages, renderer, bridge ──')
const ipcSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf-8')
ok(ipcSrc.includes('depthBoost') && ipcSrc.includes('depthSourceCount'), 'search handler applies depth policy')
ok(ipcSrc.includes("'history:sem'"), 'semantic search IPC present')
ok(ipcSrc.includes("buildSearchMessages(String(payload.q || ''), sources, depth)"), 'depth flows into the prompt')
const tabsSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'tabs.ts'), 'utf-8')
ok(tabsSrc.includes('maybeSummarizePage'), 'TL;DR hooked into tab loads')
const pagesSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf-8')
ok(pagesSrc.includes('PRIVACY_HTML') && pagesSrc.includes('AI privacy pledge'), 'pledge page exists')
ok(pagesSrc.includes('never leaves this device'), 'pledge claim: history stays local')
ok(pagesSrc.includes('127.0.0.1:11434'), 'pledge claim: local Ollama endpoint')
ok(pagesSrc.includes('id="searchDepth"') && pagesSrc.includes('id="tldrHosts"'), 'depth + TLDR settings UI present')
ok(pagesSrc.includes('Find that article'), 'history page has semantic search button')
const idxSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'index.ts'), 'utf-8')
ok(idxSrc.includes('privacy: PRIVACY_HTML'), 'aether://privacy route registered')
const apiSrc = fs.readFileSync(path.join(APP, 'src', 'preload', 'api.ts'), 'utf-8')
ok(apiSrc.includes("subscribe('tldr:summary')"), 'bridge exposes the TL;DR stream')
ok(apiSrc.includes("invoke('history:sem', q)"), 'bridge exposes semSearch with the query')
const typesSrc = fs.readFileSync(path.join(APP, 'src', 'shared', 'types.ts'), 'utf-8')
ok(typesSrc.includes("searchDepth: 'quick' | 'deep' | 'academic' | 'code'") && typesSrc.includes('tldrHosts'), 'AI settings typed')
const storeSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'store.ts'), 'utf-8')
ok(storeSrc.includes("searchDepth: 'quick'") && storeSrc.includes('tldrHosts: []'), 'AI defaults conservative')
const appSrc = fs.readFileSync(path.join(APP, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')
ok(appSrc.includes('<TldrToast />'), 'TLDR toast mounted')
const macrosSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'macros.ts'), 'utf-8')
ok(macrosSrc.includes('export function exportMacro') || macrosSrc.includes('export async function exportMacro'), '#80 macro export exists (shipped earlier, verified here)')
ok(macrosSrc.includes('importMacro'), '#80 macro import exists')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
for (const d of fs.readdirSync(APP)) {
  if (d.startsWith('.test-v185-')) fs.rmSync(path.join(APP, d), { recursive: true, force: true })
}
console.log(`\n═══ test-v185: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
