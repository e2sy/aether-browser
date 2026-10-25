/**
 * v1.1 unit tests — CRX parser, macro import validation, memory-saver tiers.
 *
 * Run:  node scripts/test-v11.mjs
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

/* ---------- build a runnable bundle with electron + native-ish deps stubbed ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test11-'))

function stubModule(name, code) {
  const dir = path.join(tmp, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.js'), code)
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
}

stubModule(
  'electron',
  `module.exports = {
     app: { getPath: () => '${tmp.replace(/\\/g, '/')}/userdata', isPackaged: false, getAppPath: () => '${APP.replace(/\\/g, '/')}' },
     session: { defaultSession: {} },
     BrowserWindow: class { constructor() { this.webContents = { send() {} } } isDestroyed() { return false } },
     WebContentsView: class {},
     shell: {},
     dialog: {},
     Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
     protocol: { handle() {}, registerSchemesAsPrivileged() {} },
     ipcMain: { handle() {} },
     webUtils: {}
   }`
)
stubModule('extract-zip', `module.exports = async function () { throw new Error('no extraction in unit tests') }`)
stubModule(
  'electron-chrome-extensions',
  `module.exports = class ElectronChromeExtensions { constructor() {} on() {} getContextMenuItems() { return [] } addTab() {} selectTab() {} }`
)
/* v1.2.0: tabs.ts -> adblock.ts drags the adblocker stack into the sandbox graph — stub it */
stubModule(
  '@cliqz/adblocker',
  `module.exports = { FiltersEngine: class FiltersEngine { static deserialize() { return new FiltersEngine() } } }`
)
stubModule(
  '@cliqz/adblocker-electron',
  `module.exports = { ElectronBlocker: class ElectronBlocker {}, fromElectronDetails: () => ({}) }`
)
stubModule(
  'tldts-experimental',
  `module.exports = { parse: () => null }`
)

fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

const entry = path.join(tmp, 'src', 'main', 'testable.ts')
fs.writeFileSync(
  entry,
  `export { parseCrx } from './crx'
   export { validateMacroImport, saveMacro, listMacros } from './macros'
   export { tierFor } from './tabs'`
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

/* ================= 1. CRX container parser ================= */
console.log('\n[1] CRX parser (parseCrx)')

function makeCrx(version, headerLen, headerByte, zipText) {
  const buf = Buffer.alloc(12 + headerLen + Buffer.byteLength(zipText))
  buf.write('Cr24', 0, 'ascii')
  buf.writeUInt32LE(version, 4)
  buf.writeUInt32LE(headerLen, 8)
  if (headerLen > 0) buf.fill(headerByte, 12, 12 + headerLen)
  Buffer.from(zipText).copy(buf, 12 + headerLen)
  return buf
}

const crx2 = makeCrx(2, 8, 0xab, 'PK-fake-zip-payload')
const r2 = B.parseCrx(crx2)
ok(r2.ok === true, 'valid CRX2 parses')
ok(r2.version === 2, 'CRX2 version detected')
ok(r2.zip && r2.zip.toString() === 'PK-fake-zip-payload', 'CRX2 zip payload extracted after header')

const crx3 = makeCrx(3, 402, 0x0a, 'PK-zip-v3-body')
const r3 = B.parseCrx(crx3)
ok(r3.ok === true && r3.version === 3, 'valid CRX3 parses with version 3')
ok(r3.zip && r3.zip.toString() === 'PK-zip-v3-body', 'CRX3 zip payload offset (12 + headerLen) is correct')

ok(B.parseCrx(Buffer.from('not a crx file at all')).ok === false, 'bad magic rejected')
ok(B.parseCrx(Buffer.alloc(4)).ok === false, 'truncated file rejected')
ok(B.parseCrx(makeCrx(5, 4, 0, 'zip')).ok === false, 'unknown CRX version rejected')

// a CRX that *claims* a 900-byte header but only ships 10 bytes of it
const liar = Buffer.alloc(12 + 10)
liar.write('Cr24', 0, 'ascii')
liar.writeUInt32LE(3, 4)
liar.writeUInt32LE(900, 8)
liar.fill(0x0a, 12)
const rLiar = B.parseCrx(liar)
ok(rLiar.ok === false, 'header larger than file rejected')
ok(typeof rLiar.error === 'string' && rLiar.error.length > 0, 'rejections carry a human-readable error')

/* ================= 2. macro import validation ================= */
console.log('\n[2] macro import (validateMacroImport)')

const good = B.validateMacroImport({
  aetherMacro: 1,
  name: 'My flow',
  task: 'search and open',
  steps: [
    { tool: 'navigate', args: { url: 'https://example.com' } },
    { tool: 'click', args: { ref: 2 } },
    { tool: 'type', args: { ref: 1, text: 'hello', submit: true } }
  ]
})
ok(!('error' in good), 'valid macro file accepted')
ok(good.steps?.length === 3, 'all replayable steps kept')
ok(good.name === 'My flow', 'name preserved')

ok('error' in B.validateMacroImport({ name: 'no marker' }), 'missing aetherMacro marker rejected')
ok('error' in B.validateMacroImport(null), 'null rejected')
ok('error' in B.validateMacroImport('string'), 'non-object rejected')
ok('error' in B.validateMacroImport({ aetherMacro: 1, name: '', steps: [{ tool: 'click', args: {} }] }), 'empty name rejected')
ok('error' in B.validateMacroImport({ aetherMacro: 1, name: 'x', steps: [] }), 'zero steps rejected')

const filtered = B.validateMacroImport({
  aetherMacro: 1,
  name: 'Partial',
  task: '',
  steps: [
    { tool: 'navigate', args: { url: 'https://example.com' } },
    { tool: 'screenshot', args: {} },
    { tool: 'ask_user', args: { question: 'hi' } }
  ]
})
ok(!('error' in filtered) && filtered.steps.length === 1, 'non-replayable tools dropped')
ok(Boolean(filtered.warning), 'dropped steps produce a warning')

const oversize = B.validateMacroImport({
  aetherMacro: 1,
  name: 'Big',
  task: '',
  steps: [
    { tool: 'navigate', args: { url: 'https://ok.example.com' } },
    { tool: 'type', args: { ref: 1, text: 'x'.repeat(5000) } }
  ]
})
ok(!('error' in oversize) && oversize.steps.length === 1, 'oversized args step dropped')
ok(oversize.steps[0]?.args?.url === 'https://ok.example.com', 'surviving steps intact')

/* ================= 3. memory saver tiers ================= */
console.log('\n[3] memory-saver tier math (tierFor)')

ok(B.tierFor(5, 30) === 'none', 'fresh tab stays untouched')
ok(B.tierFor(29.9, 30) === 'none', 'just under the threshold stays untouched')
ok(B.tierFor(30, 30) === 'hibernate', 'idle = base → hibernate')
ok(B.tierFor(60, 30) === 'hibernate', 'idle = 2×base → still hibernate (instant wake preferred)')
ok(B.tierFor(90, 30) === 'discard', 'idle = 3×base → full discard')
ok(B.tierFor(240, 30) === 'discard', 'idle far beyond → discard')
ok(B.tierFor(100, 0) === 'none', 'memory saver disabled → never')
ok(B.tierFor(100, -5) === 'none', 'negative threshold → never')

/* ================= 4. regression: v1.0 suites still hold ================= */
console.log('\n[4] regression — saveMacro still validates via the shared sanitizer')
const reg = B.saveMacro('Regr', 'task', [{ tool: 'navigate', args: { url: 'https://example.com' } }])
ok(Boolean(reg.macro), 'saveMacro still stores a valid macro')
ok(B.listMacros().some((m) => m.id === reg.macro.id), 'saved macro is listed')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
