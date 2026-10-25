/**
 * v1.0 unit tests — macro editor, per-host zoom store, download filename
 * dedupe, and the new settings defaults (memory saver + extensions).
 *
 * Run:  node scripts/test-v10.mjs
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

/* ---------- build a runnable bundle with electron stubbed ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test10-'))
const stubDir = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(stubDir, { recursive: true })
fs.writeFileSync(
  path.join(stubDir, 'index.js'),
  `module.exports = {
     app: { getPath: () => '${tmp.replace(/\\/g, '/')}/userdata', isPackaged: false },
     session: { defaultSession: {} },
     BrowserWindow: class {},
     WebContentsView: class {},
     shell: {},
     DownloadItem: class {}
   }`
)
fs.writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }))

fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

const entry = path.join(tmp, 'src', 'main', 'testable.ts')
fs.writeFileSync(
  entry,
  `export { updateMacro, saveMacro, listMacros } from './macros'
   export { getZoomLevel, setZoomLevel, zoomLevels, mergedSettings } from './store'
   export { uniquePath } from './downloads'`
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

/* ================= 1. macro editor ================= */
console.log('\n[1] macro editor — updateMacro')
const saved = B.saveMacro('Test macro', 'do things', [
  { tool: 'navigate', args: { url: 'https://example.com' } },
  { tool: 'click', args: { ref: 3 } },
  { tool: 'type', args: { ref: 1, text: 'hello', submit: true } }
])
ok(Boolean(saved.macro), 'saveMacro stores a valid macro')
const macroId = saved.macro.id

const renamed = B.updateMacro(macroId, { name: 'Renamed macro' })
ok(renamed.macro?.name === 'Renamed macro', 'rename works')

const reordered = B.updateMacro(macroId, {
  steps: [
    { tool: 'type', args: { ref: 1, text: 'hello', submit: true } },
    { tool: 'navigate', args: { url: 'https://example.com' } }
  ]
})
ok(reordered.macro?.steps?.length === 2, 'step edit keeps allowed steps')
ok(reordered.macro?.steps?.[0]?.tool === 'type', 'reorder puts type first')

const badTool = B.updateMacro(macroId, { steps: [{ tool: 'screenshot', args: {} }] })
ok(Boolean(badTool.error), 'non-replayable tools are rejected')

const empty = B.updateMacro(macroId, { steps: [] })
ok(Boolean(empty.error), 'empty step list is rejected')

const missing = B.updateMacro('no-such-id', { name: 'x' })
ok(Boolean(missing.error), 'unknown macro id errors')

const argClean = B.updateMacro(macroId, { steps: [{ tool: 'type', args: { ref: '5', submit: 'true' } }] })
ok(argClean.macro?.steps?.[0]?.args?.ref === '5', 'store preserves args verbatim (typing happens in the UI)')

/* ================= 2. per-host zoom store ================= */
console.log('\n[2] per-site zoom store')
ok(B.getZoomLevel('example.com') === 0, 'default zoom level is 0 (100%)')
B.setZoomLevel('example.com', 1.5)
ok(B.getZoomLevel('example.com') === 1.5, 'set + get round-trips')
B.setZoomLevel('example.com', 0.30000000004)
ok(B.getZoomLevel('example.com') === 0.3, 'levels are rounded to 3 decimals')
B.setZoomLevel('example.com', 0)
ok(B.getZoomLevel('example.com') === 0, 'resetting to 0 deletes the entry')
B.setZoomLevel('', 2)
ok(Object.keys(B.zoomLevels.data).length === 0, 'empty host is ignored')

/* ================= 3. download filename dedupe ================= */
console.log('\n[3] download dedupe — uniquePath')
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'))
ok(B.uniquePath(dlDir, 'file.zip').endsWith('file.zip'), 'first download keeps its name')
fs.writeFileSync(path.join(dlDir, 'file.zip'), 'x')
ok(B.uniquePath(dlDir, 'file.zip').endsWith('file (1).zip'), 'collision gets " (1)" suffix')
fs.writeFileSync(path.join(dlDir, 'file (1).zip'), 'x')
ok(B.uniquePath(dlDir, 'file.zip').endsWith('file (2).zip'), 'second collision gets " (2)" suffix')
ok(B.uniquePath(dlDir, 'a/bad\\path.zip').endsWith('bad_path.zip'), 'path separators are sanitized')
ok(path.basename(B.uniquePath(dlDir, '')).startsWith('download'), 'empty filename falls back to "download"')

/* ================= 4. new settings defaults ================= */
console.log('\n[4] settings defaults — memory saver + extensions')
const merged = B.mergedSettings()
ok(merged.memorySaver === 30, 'memory saver defaults to 30 minutes')
ok(Array.isArray(merged.extensions) && merged.extensions.length === 0, 'extensions default to empty list')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
