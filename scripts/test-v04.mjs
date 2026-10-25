/**
 * v0.4 unit tests — bundles the main-process modules with a stubbed `electron`
 * and exercises the new pure logic: DOM diffing, page memory, cloud fallback
 * SSE parsing, macro store validation, permissions store.
 *
 * Run:  node scripts/test-v04.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test-'))
const stubDir = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(stubDir, { recursive: true })
fs.writeFileSync(
  path.join(stubDir, 'index.js'),
  `module.exports = {
     app: { getPath: () => '/tmp/aether-test-userdata', isPackaged: false },
     session: {
       defaultSession: {
         setPermissionRequestHandler: function () {},
         setPermissionCheckHandler: function () {}
       }
     },
     BrowserWindow: class {},
     WebContentsView: class {}
   }`
)
fs.writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }))

// copy the app sources so relative imports resolve inside tmp
fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

const entry = path.join(tmp, 'src', 'main', 'testable.ts')
fs.writeFileSync(
  entry,
  `export * from './agent/serializer'
   export * from './memory'
   export * from './brain'
   export * from './macros'
   export * from './permissions'
   export { settings } from './store'`
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

/* ================= 1. DOM diffing (serializer) ================= */
console.log('\n[1] DOM diffing — formatSnapshotDiff')
const mkEl = (ref, tag, text, extra = {}) => ({ ref, tag, text, key: `${tag}|${text}#${extra.n || 1}`, ...extra })
const snapA = {
  url: 'https://x.com/a',
  title: 'A',
  text: 'hello world',
  elements: [mkEl(0, 'input', '', { placeholder: 'Search' }), mkEl(1, 'button', 'Go'), mkEl(2, 'a', 'Home')]
}
const snapSame = { ...snapA }
const diffNone = B.formatSnapshotDiff(snapA, snapSame)
ok(diffNone.includes('UNCHANGED'), 'unchanged page reports UNCHANGED')

const snapB = {
  url: 'https://x.com/a',
  title: 'A',
  text: 'hello world — new content arrived',
  elements: [mkEl(0, 'input', '', { placeholder: 'Search' }), mkEl(1, 'button', 'Go'), mkEl(5, 'button', 'OK', { n: 9 })]
}
const diffB = B.formatSnapshotDiff(snapA, snapB)
ok(diffB.includes('+ [5] button "OK"'), 'added element listed with + and its stable ref')
ok(diffB.includes('- [2] a "Home"'), 'removed element listed with - and its old ref')
ok(diffB.includes('earlier [refs] remain valid'), 'diff tells the model other refs stay valid')

/* ================= 2. page memory ================= */
console.log('\n[2] page memory — add / recall / prompt')
B.addMemory({ host: 'docs.python.org', url: 'https://docs.python.org/3/tutorial', title: 'The Python Tutorial', q: 'What is a list comprehension?', a: 'A concise way to create lists: [x*x for x in range(10)].' })
B.addMemory({ host: 'docs.python.org', url: 'https://docs.python.org/3/tutorial', title: 'The Python Tutorial', q: 'How do dicts work?', a: 'Dicts map keys to values.' })
B.addMemory({ host: 'news.ycombinator.com', url: 'https://news.ycombinator.com', title: 'HN', q: 'Top story?', a: 'Some story.' })
const py = B.memoriesForHost('docs.python.org')
ok(py.length === 2, 'two memories stored for the same host')
ok(py[0].q.includes('dicts'), 'newest memory first')
const prompt = B.memoryPromptFor('docs.python.org')
ok(prompt.includes('NOTES FROM YOUR PREVIOUS CONVERSATIONS'), 'prompt block header present')
ok(prompt.includes('list comprehension'), 'prompt includes remembered answer content')
ok(B.memoryPromptFor('unknown.example') === '', 'empty prompt for unknown host')
B.clearMemory()
ok(B.listMemory().length === 0, 'clearMemory empties the store')

/* ================= 3. cloud fallback SSE parsing ================= */
console.log('\n[3] cloud fallback — OpenAI SSE parsing')
const chunks = [
  'data: {"choices":[{"delta":{"content":"Hel"}}]}',
  'data: {"choices":[{"delta":{"content":"lo"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":" world"}}]}',
  'data: [DONE]'
]
const srv = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const c of chunks) res.write(c + '\n')
  res.end()
})
await new Promise((r) => srv.listen(0, r))
const port = srv.address().port

// configure the fallback via the settings store
B.settings.data.cloudFallback = { enabled: true, baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-test', model: 'test-model' }
let out = ''
for await (const d of B.cloudChatStream(B.settings.data.cloudFallback, 'test-model', [{ role: 'user', content: 'hi' }])) out += d
ok(out === 'Hello world', `SSE deltas concatenated ("${out}")`)
srv.close()

// resolveBrain falls back to the configured cloud when Ollama is unreachable
const brain = await B.resolveBrain()
ok(brain && brain.provider === 'cloud' && brain.model === 'test-model', 'resolveBrain falls back to configured cloud when Ollama is down')

// disabled cloud + no Ollama → null
B.settings.data.cloudFallback = { enabled: false, baseUrl: '', apiKey: '', model: '' }
const none = await B.resolveBrain()
ok(none === null, 'resolveBrain returns null with fallback disabled')

/* ================= 4. macro store validation ================= */
console.log('\n[4] macros — validation + persistence')
const bad = B.saveMacro('', 'task', [{ tool: 'click', args: { ref: 1 } }])
ok(Boolean(bad.error), 'rejects macro without a name')
const bad2 = B.saveMacro('M2', 'task', [{ tool: 'ask_user', args: {} }])
ok(Boolean(bad2.error), 'rejects macros with no replayable steps')
const good = B.saveMacro('Order coffee', 'order coffee', [
  { tool: 'navigate', args: { url: 'https://cafe.example' } },
  { tool: 'click', args: { ref: 3, __locator: '#add-to-cart' } },
  { tool: 'type', args: { ref: 1, text: 'oat milk', __locator: 'input[name="note"]' } },
  { tool: 'read_page', args: {} }
])
ok(Boolean(good.macro), 'valid macro saved')
ok(good.macro.steps.length === 3, 'non-replayable step (read_page) filtered out')
ok(B.listMacros().length === 1 && B.listMacros()[0].name === 'Order coffee', 'macro persisted and listed')
B.deleteMacro(good.macro.id)
ok(B.listMacros().length === 0, 'macro deleted')

/* ================= 5. permissions store ================= */
console.log('\n[5] permissions — store basics')
B.installPermissionHandlers(() => {}) // no chrome window in tests — prompts just time out
ok(Array.isArray(B.listPermissions()) && B.listPermissions().length === 0, 'permission store starts empty')
B.clearPermissions()
ok(B.listPermissions().length === 0, 'clearPermissions works')

/* ================= summary ================= */
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
