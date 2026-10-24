/**
 * v1.1.1 unit tests — Windows-safe download filenames and the electron
 * auto-repair binary detection.
 *
 * Run:  node scripts/test-v111.mjs
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test111-'))
const stubDir = path.join(tmp, 'node_modules', 'electron')
fs.mkdirSync(stubDir, { recursive: true })
fs.writeFileSync(
  path.join(stubDir, 'index.js'),
  `module.exports = {
     app: { getPath: () => '${tmp.replace(/\\/g, '/')}/userdata', isPackaged: false, getVersion: () => '1.1.1' },
     session: { defaultSession: {} },
     BrowserWindow: class {},
     WebContentsView: class {},
     shell: {},
     DownloadItem: class {}
   }`
)
fs.writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }))

execSync(`cp -r ${APP}/src ${tmp}/src`, { stdio: 'pipe' })

const entry = path.join(tmp, 'src', 'main', 'testable.ts')
fs.writeFileSync(
  entry,
  `export { sanitizeFilename, uniquePath } from './downloads'`
)

execSync(
  `${APP}/node_modules/.bin/esbuild ${entry} --bundle --platform=node --format=esm --external:jsdom --external:turndown --external:@mozilla/readability --outfile=${tmp}/bundle.mjs`,
  { stdio: 'pipe' }
)

const B = await import(path.join(tmp, 'bundle.mjs'))

/* ---------- sanitizeFilename: Windows-illegal characters ---------- */
console.log('\nsanitizeFilename — illegal characters & paths')
ok(B.sanitizeFilename('report:.pdf') === 'report.pdf', 'colon stripped (NTFS streams blocked)')
ok(B.sanitizeFilename('a<b>c|d"e?f*g.pdf') === 'abcdefg.pdf', 'all <>: "|?* chars stripped')
ok(B.sanitizeFilename('path/to/file.zip') === 'path_to_file.zip', 'forward slashes flattened')
ok(B.sanitizeFilename('path\\to\\file.zip') === 'path_to_file.zip', 'backslashes flattened')
ok(B.sanitizeFilename('invoice\u0001.pdf') === 'invoice.pdf', 'control characters stripped')

console.log('\nsanitizeFilename — trailing dots/spaces (Windows rejects these)')
ok(B.sanitizeFilename('file.zip...') === 'file.zip', 'trailing dots removed')
ok(B.sanitizeFilename('file.zip   ') === 'file.zip', 'trailing spaces removed')
ok(B.sanitizeFilename('file.zip . ') === 'file.zip', 'mixed trailing dot/space removed')

console.log('\nsanitizeFilename — reserved device names (CON, NUL, COM1…)')
ok(B.sanitizeFilename('CON') === '_CON', 'CON prefixed')
ok(B.sanitizeFilename('con') === '_con', 'case-insensitive: con prefixed')
ok(B.sanitizeFilename('NUL.txt') === '_NUL.txt', 'NUL.txt prefixed (reserved with extension)')
ok(B.sanitizeFilename('COM1.pdf') === '_COM1.pdf', 'COM1 prefixed')
ok(B.sanitizeFilename('lpt9') === '_lpt9', 'LPT9 prefixed')
ok(B.sanitizeFilename('conference notes.txt') === 'conference notes.txt', 'normal names containing reserved words are untouched')
ok(B.sanitizeFilename('com10') === 'com10', 'COM10 (out of reserved range) untouched')

console.log('\nsanitizeFilename — fallbacks')
ok(B.sanitizeFilename('') === 'download', 'empty name → download')
ok(B.sanitizeFilename('???') === 'download', 'all-illegal name → download')
ok(B.sanitizeFilename('   ') === 'download', 'whitespace-only → download')

/* ---------- uniquePath still dedupes (regression from v1.0) ---------- */
console.log('\nuniquePath — dedupe regression')
const dir = path.join(tmp, 'dl')
fs.mkdirSync(dir, { recursive: true })
const p1 = B.uniquePath(dir, 'aether-setup.exe')
fs.writeFileSync(p1, 'x')
const p2 = B.uniquePath(dir, 'aether-setup.exe')
fs.writeFileSync(p2, 'x')
const p3 = B.uniquePath(dir, 'aether-setup.exe')
ok(p1.endsWith('aether-setup.exe'), 'first save uses the plain name')
ok(p2.endsWith('aether-setup (1).exe'), 'second save gets " (1)" suffix')
ok(p3.endsWith('aether-setup (2).exe'), 'third save gets " (2)" suffix')
ok(B.uniquePath(dir, 'CON.exe').endsWith('_CON.exe'), 'reserved name sanitized before dedupe')

/* ---------- ensure-electron.mjs: happy-path exit 0 when binary exists ---------- */
console.log('\nensure-electron.mjs — auto-repair logic')
const fakeElectron = path.join(APP, 'node_modules', 'electron')
const distDir = path.join(fakeElectron, 'dist')
const createdDist = !fs.existsSync(distDir)
if (createdDist) fs.mkdirSync(distDir, { recursive: true })
const binName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const binPath = path.join(distDir, binName)
const createdBin = !fs.existsSync(binPath)
if (createdBin) fs.writeFileSync(binPath, '#!/bin/sh\n')
const r = execSync('node scripts/ensure-electron.mjs', { cwd: APP, stdio: 'pipe' })
ok(r !== undefined, 'exits 0 when the platform binary already exists (no needless download)')
if (createdBin) fs.rmSync(binPath)
if (createdDist) fs.rmSync(distDir, { recursive: true, force: true })

/* ---------- summary ---------- */
console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
