#!/usr/bin/env node
/**
 * v2.6.0 build 20 — AI differentiators: multimodal image-ask, full-page
 * translate (local Ollama), smart tab clustering.
 *
 * Coverage:
 *  - shared/semvec.ts (extracted cosine/topK — regression for semhistory)
 *  - shared/imgask.ts (vision capability detection, model preference tiers,
 *    data-URL → base64, byte math)
 *  - shared/tabcluster.ts (title tokenization, cluster labels, greedy
 *    centroid clustering, topic-group build policy with uniqueness)
 *  - shared/translate.ts (chunking, numbered-line prompt, tolerant parser,
 *    language list/lookup, progress)
 *  - shared/transmodel.ts (translate model preference)
 *  - static wiring gates (IPC guards, menu entries, page registration,
 *    preload bridge, sidebar image flow, textContent-only translate page)
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireCjs = createRequire(import.meta.url)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// bundles must live INSIDE the app tree so require() resolves
const outdir = path.join(ROOT, '.test-v260-tmp')
try {
  rmSync(outdir, { recursive: true, force: true })
} catch {
  /* first run */
}
mkdirSync(outdir, { recursive: true })

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) pass++
  else {
    fail++
    console.error('  FAIL:', label)
  }
}
function section(name) {
  console.log(`\n=== ${name} ===`)
}

async function bundleMain(rel, external = []) {
  const { outputFiles } = await build({
    entryPoints: [path.join(ROOT, 'src', rel)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external,
    outfile: path.join(outdir, rel.replace(/[\\/]/g, '_') + '.cjs'),
    write: false,
    logLevel: 'silent'
  })
  const file = path.join(outdir, rel.replace(/[\\/]/g, '_') + '.cjs')
  writeFileSync(file, outputFiles[0].text)
  return requireCjs(file)
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf-8')
}

/* ── shared/semvec.ts ─────────────────────────────────────────────────────── */
section('semvec: cosine similarity + topK')
const semvec = await bundleMain('shared/semvec.ts')
{
  ok(Math.abs(semvec.cosineSim([1, 0], [1, 0]) - 1) < 1e-9, 'identical vectors → 1')
  ok(Math.abs(semvec.cosineSim([1, 0], [0, 1])) < 1e-9, 'orthogonal vectors → 0')
  ok(semvec.cosineSim([], []) === 0, 'empty vectors → 0')
  ok(semvec.cosineSim([1, 2], [1, 2, 3]) === 0, 'length mismatch → 0')
  ok(semvec.cosineSim('x', [1]) === 0, 'non-array input → 0')
  ok(Math.abs(semvec.cosineSim([3, 0], [9, 0]) - 1) < 1e-9, 'scale invariant')
  const items = [
    { vec: [1, 0], n: 'a' },
    { vec: [0.9, 0.1], n: 'b' },
    { vec: [0, 1], n: 'c' }
  ]
  const hits = semvec.topK(items, [1, 0], 2)
  ok(hits.length === 2 && hits[0].item.n === 'a' && hits[1].item.n === 'b', 'topK ranks by similarity')
}

/* ── shared/imgask.ts ─────────────────────────────────────────────────────── */
section('imgask: vision model selection')
const imgask = await bundleMain('shared/imgask.ts')
{
  ok(imgask.capabilitiesSayVision(['embedding', 'vision']), 'capabilities array with vision → true')
  ok(!imgask.capabilitiesSayVision(['embedding']), 'capabilities without vision → false')
  ok(!imgask.capabilitiesSayVision('vision'), 'non-array capabilities → false')
  ok(imgask.nameLooksVision('llava:13b'), 'llava name detected')
  ok(imgask.nameLooksVision('llama3.2-vision:11b'), 'llama3.2-vision detected')
  ok(imgask.nameLooksVision('minicpm-v:8b'), 'minicpm-v detected')
  ok(!imgask.nameLooksVision('qwen3.5:9b'), 'text-only qwen not flagged')
  ok(!imgask.nameLooksVision('nomic-embed-text'), 'embedding model not flagged')

  const capConfirmed = imgask.pickVisionModel([
    { name: 'llava:7b' },
    { name: 'qwen3.5:9b', caps: ['vision'] }
  ])
  ok(capConfirmed === 'qwen3.5:9b', 'capability-confirmed beats name-guess')

  const byRank = imgask.pickVisionModel([
    { name: 'moondream:latest' },
    { name: 'llava:13b' }
  ])
  ok(byRank === 'llava:13b', 'pattern order prefers llama/llava over moondream')

  ok(imgask.pickVisionModel([{ name: 'qwen3.5:9b' }]) === null, 'no vision candidates → null')
  ok(imgask.pickVisionModel([]) === null, 'empty list → null')

  const b64 = imgask.dataUrlToBase64('data:image/png;base64,QUJD')
  ok(b64 === 'QUJD', 'data URL stripped to base64')
  ok(imgask.dataUrlToBase64('data:text/html;base64,QUJD') === null, 'non-image data URL rejected')
  ok(imgask.dataUrlToBase64('https://x/y.png') === null, 'plain URL rejected')
  ok(imgask.base64Bytes('QUJD') === 3, 'base64 byte math (3 chars → 3 bytes)')
  ok(imgask.base64Bytes('QQ==') === 1, 'base64 padding accounted')
  ok(imgask.IMG_MAX_BYTES === 5 * 1024 * 1024, '5 MB image cap')
  ok(imgask.IMG_MAX_MESSAGES === 4, 'max 4 images per request')
}

/* ── shared/tabcluster.ts ─────────────────────────────────────────────────── */
section('tabcluster: tokens, labels, clustering')
const tc = await bundleMain('shared/tabcluster.ts')
{
  const toks = tc.tokenizeTitle('The Best Pasta Recipes - Food Network')
  ok(!toks.includes('the') && !toks.includes('best'), 'stopwords dropped')
  ok(toks.includes('pasta') && toks.includes('recipes'), 'content words kept')
  ok(tc.tokenizeTitle('ab it of').length === 0, 'short/stopword-only title → no tokens')
  ok(tc.tokenizeTitle('').length === 0, 'empty title → no tokens')

  const label = tc.labelForTitles(
    ['Pasta recipes for dinner', 'Easy pasta dinner', 'Best pasta shapes'],
    'Group 1'
  )
  ok(/^Pasta/.test(label), 'label leads with the most common token')
  ok(label.length <= 40, 'label capped at 40 chars')
  ok(tc.labelForTitles([], 'Fallback') === 'Fallback', 'no tokens → fallback label')
  ok(tc.labelForTitles(['???', '123'], 'FB') === 'FB', 'punctuation-only titles → fallback')

  // 2-D synthetic vectors: 0-2 cluster near (1,0); 3-4 cluster near (0,1)
  const vecs = [
    [1, 0],
    [0.95, 0.05],
    [0.9, 0.1],
    [0, 1],
    [0.05, 0.95]
  ]
  const clusters = tc.clusterIndices(vecs, 0.8)
  ok(clusters.length === 2, 'two obvious clusters found')
  ok(
    clusters[0].length === 3 && clusters[1].length === 2,
    'cluster membership matches geometry'
  )
  ok(tc.clusterIndices([], 0.5).length === 0, 'no vectors → no clusters')
  ok(tc.clusterIndices([[NaN, 1], [1, 0]], 0.5).length === 1, 'malformed vector skipped, valid one clustered')
  const one = tc.clusterIndices([[1, 0]], 0.5)
  ok(one.length === 1 && one[0].length === 1, 'single vector → single singleton cluster')
}

section('tabcluster: buildTopicGroups policy')
{
  const items = [
    { index: 11, title: 'React docs hooks', vec: [1, 0] },
    { index: 12, title: 'React hooks guide', vec: [0.95, 0.05] },
    { index: 13, title: 'React hooks tutorial', vec: [0.9, 0.1] },
    { index: 21, title: 'Pasta recipes', vec: [0, 1] },
    { index: 22, title: 'Italian pasta recipe', vec: [0.05, 0.95] },
    { index: 31, title: 'Lonely tab about weather', vec: [0.7, 0.7] }
  ]
  const groups = tc.buildTopicGroups(items, 0.8, 2)
  ok(groups.length === 2, 'two groups (min size 2) — singleton dropped')
  ok(groups[0].members.length === 3 && groups[1].members.length === 2, 'members routed correctly')
  ok(groups[0].members[0].index === 11, 'member keeps tab id as index')
  ok(groups[0].colorIndex === 0 && groups[1].colorIndex === 1, 'palette index cycles')
  const strict = tc.buildTopicGroups(items, 0.8, 3)
  ok(strict.length === 1 && strict[0].members.length === 3, 'minSize 3 keeps only the 3-member cluster')
  const first = tc.buildTopicGroups(items, 0.8, 3)[0]
  const again = tc.buildTopicGroups(items, 0.8, 3, [first.label])
  ok(again[0].label !== first.label, 'existing group names avoided')
  ok(again[0].label === first.label + ' 2', 'colliding label gets a numeric suffix')
  const tooFew = tc.buildTopicGroups(items.slice(0, 2), 0.8, 3)
  ok(tooFew.length === 0, 'clusters under minSize are not proposed')
}

/* ── shared/translate.ts ──────────────────────────────────────────────────── */
section('translate: chunking + prompt + parser')
const tr = await bundleMain('shared/translate.ts')
{
  const chunks = tr.makeTranslateChunks(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3)
  ok(chunks.length === 3 && chunks[0].length === 3 && chunks[2].length === 1, 'chunking splits with short tail')
  ok(tr.makeTranslateChunks(['', '   ', 'x'], 2).length === 1, 'empty paragraphs dropped')
  ok(tr.makeTranslateChunks([], 2).length === 0, 'no paras → no chunks')
  const big = 'x'.repeat(1500)
  ok(tr.makeTranslateChunks([big], 2)[0][0].length <= 1201, 'oversized paragraph sliced')
  ok(tr.makeTranslateChunks(['a\n  b'.repeat(1)], 2)[0][0] === 'a b', 'whitespace collapsed')

  const prompt = tr.buildTranslatePrompt(['Hello world', 'Good night'], 'hi')
  ok(prompt.includes('Hindi'), 'prompt names the target language')
  ok(prompt.includes('1. Hello world') && prompt.includes('2. Good night'), 'prompt numbers the lines')

  const parsed = tr.parseTranslatedChunk('1. नमस्ते\n2. शुभ रात्रि', 2, ['Hello world', 'Good night'])
  ok(parsed[0] === 'नमस्ते' && parsed[1] === 'शुभ रात्रि', 'numbered lines parsed in order')
  const paren = tr.parseTranslatedChunk('1) Bonjour\n2) Salut', 2, ['Hello', 'Hi'])
  ok(paren[0] === 'Bonjour' && paren[1] === 'Salut', 'paren numbering accepted')
  const partial = tr.parseTranslatedChunk('1. Hola', 2, ['Hello', 'Goodbye'])
  ok(partial[0] === 'Hola' && partial[1] === 'Goodbye', 'missing line falls back to original')
  const bare = tr.parseTranslatedChunk('Hola\nCiao', 2, ['Hello', 'Bye'])
  ok(bare[0] === 'Hola' && bare[1] === 'Ciao', 'bare lines with matching count taken in order')
  const garbage = tr.parseTranslatedChunk('I cannot translate this.', 2, ['A', 'B'])
  ok(garbage[0] === 'A' && garbage[1] === 'B', 'garbage output → originals kept')
  const empty = tr.parseTranslatedChunk('', 1, ['A'])
  ok(empty[0] === 'A', 'empty output → originals kept')

  ok(tr.langName('hi') === 'Hindi', 'langName lookup')
  ok(tr.langName('zz') === 'zz', 'unknown code falls back to itself')
  ok(tr.isLangCode('en') && tr.isLangCode('HI'), 'valid codes accepted (case-insensitive value)')
  ok(!tr.isLangCode('zz') && !tr.isLangCode(42), 'invalid codes rejected')
  ok(tr.LANGUAGES.length >= 30, 'language menu has world coverage')
  ok(tr.LANGUAGES.some((l) => l.code === 'hi') && tr.LANGUAGES.some((l) => l.code === 'ta'), 'Indian languages present')

  ok(tr.progressPct(0, 10) === 0 && tr.progressPct(5, 10) === 50 && tr.progressPct(12, 10) === 100, 'progress math')
  ok(tr.progressPct(1, 0) === 0, 'zero total → 0')
}

/* ── shared/transmodel.ts ─────────────────────────────────────────────────── */
section('transmodel: translation model preference')
const tm = await bundleMain('shared/transmodel.ts')
{
  ok(tm.pickTranslateModelFrom(['llama3.1:8b', 'qwen3.5:9b']) === 'qwen3.5:9b', 'qwen preferred for translation')
  ok(tm.pickTranslateModelFrom(['llama3.1:8b', 'gemma3:4b']) === 'gemma3:4b', 'gemma over llama')
  ok(tm.pickTranslateModelFrom(['tinyllama']) === 'tinyllama', 'unlisted model still works (fallback)')
  ok(tm.pickTranslateModelFrom([]) === null, 'no models → null')
}

/* ── wiring gates ─────────────────────────────────────────────────────────── */
section('wiring: ipc guards + vision swap')
{
  const ipc = read('src/main/ipc.ts')
  ok(ipc.includes("'tabs:cluster'") && /ipcMain\.handle\('tabs:cluster'[\s\S]{0,120}guard\(e, 'tabs:cluster'\)/.test(ipc), 'tabs:cluster guarded (chrome-only)')
  ok(ipc.includes("'tabs:translate'") && /ipcMain\.handle\('tabs:translate'[\s\S]{0,120}guard\(e, 'tabs:translate'\)/.test(ipc), 'tabs:translate guarded (chrome-only)')
  ok(/ipcMain\.handle\('translate:get'[\s\S]{0,80}isInternal/.test(ipc), 'translate:get is aether-internal only')
  ok(/ipcMain\.handle\('translate:run'[\s\S]{0,80}isInternal/.test(ipc), 'translate:run is aether-internal only')
  ok(/ipcMain\.handle\('translate:stop'[\s\S]{0,80}isInternal/.test(ipc), 'translate:stop is aether-internal only')
  ok(ipc.includes('extractChatImages') && ipc.includes('resolveVisionModel') && ipc.includes('NO_VISION_HINT'), 'ai:chat maps images + auto-swaps to a vision model')
  ok(ipc.includes("choice = { provider: 'local', model: vision }"), 'vision swap overrides the chat model')
}

section('wiring: menu + context menu')
{
  const menu = read('src/main/menu.ts')
  ok(menu.includes('Ask AI about this image'), 'image context menu: Ask AI about this image')
  ok(menu.includes('fetchImageDataUrl(params.srcURL'), 'image ask fetches the actual srcURL')
  ok(menu.includes("'sidebar:inject'") && menu.includes('image: dataUrl'), 'image ask injects into the sidebar with the image')
  ok(menu.includes("'Translate Page…'") && menu.includes('Alt+Shift+T'), 'View menu: Translate Page…')
  ok(menu.includes("'Translate page…'"), 'context menu: Translate page…')
  ok(menu.includes("'Group Tabs by Topic'") && menu.includes('clusterTabsByTopic'), 'View menu: Group Tabs by Topic')
  ok(menu.includes('captureTranslatePage(wc)') && menu.includes("'aether://translate'"), 'translate flow captures then navigates')
}

section('wiring: internal page registration + XSS posture')
{
  const index = read('src/main/index.ts')
  ok(index.includes('translate: TRANSLATE_HTML'), 'aether://translate route registered')
  ok(index.includes('smoke.translate') && index.includes('tr-empty'), 'smoke test covers the translate page')

  const pages = read('src/main/pages.ts')
  ok(pages.includes('export const TRANSLATE_HTML'), 'TRANSLATE_HTML exported')
  const trBlock = pages.slice(pages.indexOf('export const TRANSLATE_HTML'))
  ok(!/\.innerHTML\s*=/.test(trBlock), 'translate page writes via textContent only (no innerHTML sinks)')
  ok(trBlock.includes('onTranslateUpdate'), 'translate page subscribes to live progress')
  ok(trBlock.includes('localStorage.getItem'), 'language choice persists across visits')

  const reader = read('src/main/reader.ts')
  ok(reader.includes('export async function extractParagraphs'), 'reader exports the paragraph extractor')
  const extractor = reader.slice(reader.indexOf('export async function extractParagraphs'))
  ok(!/\.innerHTML/.test(extractor), 'paragraph extractor is plain text — zero injection surface')
}

section('wiring: preload bridge + sidebar image flow')
{
  const preload = read('src/preload/api.ts')
  ok(preload.includes("'tabs:cluster'"), 'preload: tabs.cluster')
  ok(preload.includes("'tabs:translate'"), 'preload: tabs.translate')
  ok(preload.includes("'translate:get'") && preload.includes("'translate:run'") && preload.includes("'translate:stop'"), 'preload: translate group')
  ok(preload.includes("subscribe('translate:update')"), 'preload: onTranslateUpdate')
  ok(preload.includes("images?: string[]"), 'preload chat payload carries images')

  const types = read('src/shared/types.ts')
  ok(/interface ChatMsg[\s\S]{0,200}images\?: string\[\]/.test(types), 'ChatMsg.images typed')
  ok(/interface SidebarInject[\s\S]{0,200}image\?: string/.test(types), 'SidebarInject.image typed')

  const sidebar = read('src/renderer/src/components/Sidebar.tsx')
  ok(sidebar.includes('pendingImage'), 'sidebar holds a pending image')
  ok(sidebar.includes('sendRef.current?.(inj.text, inj.image'), 'image inject auto-sends via the latest doSend')
  ok(sidebar.includes('msg-img'), 'user messages render the image thumbnail')
  ok(sidebar.includes('img-chip'), 'pending image renders as a removable chip')
  ok(sidebar.includes('usePage && canUsePage && !image'), 'image turns skip page context')

  const palette = read('src/renderer/src/components/CommandPalette.tsx')
  ok(palette.includes('Translate page') && palette.includes('Group tabs by topic'), 'command palette exposes both new actions')

  const sem = read('src/main/semhistory.ts')
  ok(sem.includes('export async function pickEmbedModel') && sem.includes('export async function embedText'), 'semhistory exposes embedding helpers for clustering')

  const cluster = read('src/main/tabcluster.ts')
  ok(cluster.includes('if (t.groupId) continue'), 'clustering never touches manually grouped tabs')
  ok(cluster.includes('CLUSTER_MAX_TABS') && cluster.includes('CLUSTER_MIN_SIZE'), 'clustering scope guards in place')
}

/* ── summary ──────────────────────────────────────────────────────────────── */
console.log(`\n${'='.repeat(50)}`)
console.log(`v2.6.0: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  process.exit(1)
}
try {
  rmSync(outdir, { recursive: true, force: true })
} catch {
  /* windows file locking — the tmp dir is gitignored */
}
