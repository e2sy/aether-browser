/**
 * v1.5.0 "real-browser" tests — one section per build.
 *
 * Build 1 — session restore: URL restorability, window/snapshot sanitization
 * (garbage in -> null out, never throws), caps, active-index remapping,
 * snapshot-from-entries (private windows excluded), clean-exit flag contract.
 *
 * Run:  node scripts/test-v150.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test150-'))

function stubModule(name, code) {
  const dir = path.join(tmp, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.js'), code)
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
}

stubModule('electron', `module.exports = { app: { getPath: () => '${tmp.replace(/\\/g, '/')}/userdata' } }`)
// the stub is bundled IN (via alias) so Node never has to named-import a CJS module
const electronStub = path.join(tmp, 'electron-stub.mjs')
fs.writeFileSync(
  electronStub,
  [
    "const app = { getPath: () => '${TMP}/userdata', on: () => {}, whenReady: async () => {} }",
    'const shell = {}',
    'const session = { defaultSession: {} }',
    'const BrowserWindow = Object.assign(function () {}, { getAllWindows: () => [] })',
    'class DownloadItem {}',
    // v1.7.0 build 9: oshell.ts (pulled in via downloads.ts) needs these too
    'const Menu = { buildFromTemplate: () => ({}), setApplicationMenu() {} }',
    'const Notification = { isSupported: () => false }',
    'class Tray { destroy() {} setContextMenu() {} setToolTip() {} on() {} }',
    'const nativeImage = { createFromPath: () => ({}), createFromBuffer: () => ({}) }',
    'export { app, shell, session, BrowserWindow, DownloadItem, Menu, Notification, Tray, nativeImage }'
  ].join('\n').replaceAll('${TMP}', tmp.replace(/\\/g, '/')) + '\n'
)
fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

const entry = path.join(tmp, 'src', 'main', 'testable-v150.ts')
fs.writeFileSync(
  entry,
  `export {
     isRestorableUrl, sanitizeWindow, sanitizeSession, snapshotFromEntries,
     loadSession, writeSessionNow, wasUncleanShutdown, forgetSession,
     type SessionSnapshot, type SessionWindow, type SessionTab
   } from './session-restore'
   export {
     doneStateOf as dlDoneState, sortRecords as dlSort, capLog as dlCap,
     withoutRecord as dlWithout, sanitizeFilename as dlSanitizeName
   } from './downloads'`
)

const outfile = path.join(tmp, 'bundle-v150.mjs')
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  alias: { electron: electronStub },
  logLevel: 'warning'
})

// second bundle: the settings store (mergedSettings / DEFAULT_SETTINGS)
const settingsEntry = path.join(tmp, 'src', 'main', 'testable-settings.ts')
fs.writeFileSync(
  settingsEntry,
  `export { DEFAULT_SETTINGS, mergedSettings } from './store'`
)
await build({
  entryPoints: [settingsEntry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(tmp, 'bundle-settings.mjs'),
  alias: { electron: electronStub },
  logLevel: 'warning'
})

// third bundle: shared security classification (no electron at all)
const secEntry = path.join(tmp, 'src', 'shared', 'testable-security.ts')
fs.writeFileSync(secEntry, `export { securityOf, SECURITY_LABEL } from './security'`)
await build({
  entryPoints: [secEntry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(tmp, 'bundle-security.mjs'),
  logLevel: 'warning'
})

const mod = await import(pathToFileURL(outfile).href)
const {
  isRestorableUrl,
  sanitizeWindow,
  sanitizeSession,
  snapshotFromEntries,
  loadSession,
  writeSessionNow,
  wasUncleanShutdown,
  forgetSession,
  dlDoneState,
  dlSort,
  dlCap,
  dlWithout,
  dlSanitizeName
} = mod

console.log('\n[1] session restore — URL restorability')
ok(isRestorableUrl('https://example.com') === true, 'https restored')
ok(isRestorableUrl('http://neverssl.com/page?x=1') === true, 'http restored')
ok(isRestorableUrl('aether://history') === true, 'internal manager pages restored')
ok(isRestorableUrl('aether://bookmarks') === true, 'bookmarks page restored')
ok(isRestorableUrl('aether://newtab') === false, 'newtab never restored')
ok(isRestorableUrl('aether://search?q=x') === false, 'search page never restored')
ok(isRestorableUrl('aether://error?u=https://x') === false, 'error page never restored')
ok(isRestorableUrl('devtools://devtools/bundled/x') === false, 'devtools never restored')
ok(isRestorableUrl('about:blank') === false, 'about: never restored')
ok(isRestorableUrl('data:text/html,hi') === false, 'data: never restored')
ok(isRestorableUrl('') === false, 'empty never restored')
ok(isRestorableUrl('not a url') === false, 'scheme-less junk never restored')
ok(isRestorableUrl(undefined) === false, 'undefined never restored')

console.log('\n[2] session restore — window sanitization')
const win1 = sanitizeWindow({ tabs: [{ url: 'aether://newtab', pinned: false }, { url: 'https://a.com', pinned: true }, { url: 'https://b.com', pinned: false }], active: 1 })
ok(win1 && win1.tabs.length === 2, 'newtab dropped, rest kept')
ok(win1 && win1.tabs[0].pinned === true, 'pinned flag survives')
ok(win1 && win1.active === 0, 'active index remapped to kept tab (originally 1)')
const win2 = sanitizeWindow({ tabs: [{ url: 'aether://newtab' }], active: 0 })
ok(win2 === null, 'all-newtab window dropped')
ok(sanitizeWindow(null) === null, 'null window dropped')
ok(sanitizeWindow({}) === null, 'tabless window dropped')
ok(sanitizeWindow({ tabs: 'nope' }) === null, 'hostile tabs field dropped')
ok(sanitizeWindow({ tabs: [null, undefined, 42, { url: 'https://ok.com' }], active: 99 }) !== null, 'hostile members skipped, rest kept')
const win3 = sanitizeWindow({ tabs: [{ url: 'https://a.com' }, { url: 'https://b.com' }], active: 99 })
ok(win3 && win3.active === 1, 'out-of-range active clamped')
const win4 = sanitizeWindow({ tabs: [{ url: 'https://a.com' }], active: 'garbage' })
ok(win4 && win4.active === 0, 'non-numeric active falls back to 0')

console.log('\n[3] session restore — snapshot sanitization')
ok(sanitizeSession(null) === null, 'null snapshot -> null')
ok(sanitizeSession('junk') === null, 'string snapshot -> null')
ok(sanitizeSession({ windows: 'nope' }) === null, 'hostile windows field -> null')
ok(sanitizeSession({ windows: [{ tabs: [{ url: 'aether://newtab' }] }] }) === null, 'all-empty snapshot -> null')
const s1 = sanitizeSession({
  windows: [
    { tabs: [{ url: 'https://a.com' }, { url: 'aether://newtab' }], active: 0 },
    { tabs: [{ url: 'x-not-a-url' }] },
    { tabs: [{ url: 'https://b.com' }] }
  ],
  savedAt: 123,
  cleanExit: 1
})
ok(s1 && s1.windows.length === 2, 'dead windows pruned')
ok(s1 && s1.savedAt === 123 && s1.cleanExit === true, 'metadata preserved')
const s2 = sanitizeSession({ windows: Array.from({ length: 20 }, (_, i) => ({ tabs: [{ url: 'https://w' + i + '.com' }] })) })
ok(s2 && s2.windows.length === 10, 'window cap enforced (10)')
const manyTabs = { windows: [{ tabs: Array.from({ length: 80 }, (_, i) => ({ url: 'https://t' + i + '.com' })), active: 0 }] }
ok(sanitizeSession(manyTabs).windows[0].tabs.length === 50, 'tab cap enforced (50/window)')
const s3 = sanitizeSession({ windows: [{ tabs: [{ url: 'https://a.com' }] }] })
ok(s3 && s3.savedAt > 0 && s3.cleanExit === false, 'defaults filled (savedAt, cleanExit)')

console.log('\n[4] session restore — snapshot from live entries')
function fakeEntry(tabs, activeId, opts = {}) {
  const ids = tabs.map((_, i) => i + 1)
  return {
    win: { isDestroyed: () => Boolean(opts.destroyed) },
    private: opts.private,
    tabs: {
      getState: () => ({ tabs: tabs.map((t, i) => ({ id: ids[i], ...t })), activeId }),
      // v1.8.0 build 10 — tab groups ride along in every snapshot
      groupSnapshot: () => ({ groups: [], tabGroups: {} })
    }
  }
}
const snapA = snapshotFromEntries([
  fakeEntry([{ url: 'https://a.com', pinned: false }, { url: 'https://b.com', pinned: true }], 2),
  fakeEntry([{ url: 'https://c.com', pinned: false }], 1, { destroyed: true })
])
ok(snapA.windows.length === 1 && snapA.windows[0].tabs.length === 2, 'destroyed windows excluded')
ok(snapA.windows[0].active === 1, 'active index computed from activeId')
const snapB = snapshotFromEntries([fakeEntry([{ url: 'https://secret.com' }], 1, { private: true })])
ok(snapB.windows.length === 0, 'private windows excluded from the snapshot')
const snapC = snapshotFromEntries([fakeEntry([{ url: 'https://a.com' }], 1)])
ok(snapshotFromEntries(snapC.windows.length ? [] : []).windows.length === 0, 'empty entry list -> empty snapshot')

console.log('\n[5] session restore — disk round-trip + clean-exit contract')
writeSessionNow({ windows: [{ tabs: [{ url: 'https://x.com', pinned: false }], active: 0 }], savedAt: 42 })
ok(wasUncleanShutdown() === true, 'no cleanExit flag -> unclean shutdown detected')
const loaded = loadSession()
ok(loaded && loaded.windows.length === 1 && loaded.windows[0].tabs[0].url === 'https://x.com', 'snapshot survives the disk round-trip')
writeSessionNow({ windows: [{ tabs: [{ url: 'https://x.com', pinned: false }], active: 0 }], savedAt: 42, cleanExit: true })
ok(wasUncleanShutdown() === false, 'cleanExit flag -> clean shutdown detected')
forgetSession()
ok(loadSession() === null, 'forgetSession removes the snapshot')
ok(wasUncleanShutdown() === false, 'missing snapshot -> not an unclean shutdown')
fs.writeFileSync(path.join(tmp, 'userdata', 'session.json'), '{corrupted!!')
ok(loadSession() === null, 'corrupted session.json -> null, no throw')

console.log(`\nv1.5.0 build 1 (session restore): OK — running build 2 sections`)

console.log('\n[6] downloads — state mapping + record list math')
ok(dlDoneState('completed') === 'completed', 'completed maps to completed')
ok(dlDoneState('cancelled') === 'cancelled', 'cancelled maps to cancelled')
ok(dlDoneState('interrupted') === 'interrupted', 'interrupted maps to interrupted')
ok(dlDoneState('anything') === 'interrupted', 'unknown states degrade to interrupted (fail-safe)')
const recs = [
  { id: 'a', url: 'https://x/a.zip', filename: 'a.zip', path: '/d/a.zip', total: 10, received: 10, state: 'completed', ts: 100 },
  { id: 'b', url: 'https://x/b.zip', filename: 'b.zip', path: '/d/b.zip', total: 5, received: 5, state: 'completed', ts: 300 },
  { id: 'c', url: 'https://x/c.zip', filename: 'c.zip', path: '/d/c.zip', total: 7, received: 7, state: 'interrupted', ts: 200 }
]
const sorted = dlSort(recs)
ok(sorted[0].id === 'b' && sorted[2].id === 'a', 'records sort newest first')
ok(dlCap(recs, 2).length === 2 && dlCap(recs, 2)[0].id === 'b', 'capLog keeps newest N')
ok(dlWithout(recs, 'a').length === 2 && !dlWithout(recs, 'a').some((r) => r.id === 'a'), 'withoutRecord filters by id')
ok(dlCap([], 5).length === 0, 'capLog of empty list is empty')

console.log('\n[7] downloads — filename sanitization (Windows-hardened)')
ok(dlSanitizeName('setup.exe') === 'setup.exe', 'normal name untouched')
ok(dlSanitizeName('a/b/c.txt') === 'a_b_c.txt', 'path separators flattened')
ok(dlSanitizeName('file<n>:.txt') === 'filen.txt', 'illegal chars stripped')
ok(dlSanitizeName('CON') === '_CON', 'reserved device name prefixed')
ok(dlSanitizeName('name. . ') === 'name', 'trailing dots/spaces trimmed')
ok(dlSanitizeName('') === 'download', 'empty name falls back')

console.log(`\nv1.5.0 build 2 (downloads): OK — running build 3 sections`)

console.log('\n[8] bookmarks bar — settings contract')
const { DEFAULT_SETTINGS, mergedSettings } = await import(
  pathToFileURL(path.join(tmp, 'bundle-settings.mjs')).href
)
ok(DEFAULT_SETTINGS.showBookmarksBar === true, 'bookmarks bar defaults to visible')
ok(DEFAULT_SETTINGS.restoreSession === true, 'session restore defaults to on')
const st = mergedSettings()
ok(st.showBookmarksBar === true && st.restoreSession === true, 'mergedSettings fills both new keys')
ok(typeof st.showBookmarksBar === 'boolean' && typeof st.restoreSession === 'boolean', 'both keys are real booleans')

console.log(`\nv1.5.0 build 3 (bookmarks bar): OK — running build 4 sections`)

console.log('\n[9] site security classification (shared/security.ts)')
const { securityOf, SECURITY_LABEL } = await import(
  pathToFileURL(path.join(tmp, 'bundle-security.mjs')).href
)
ok(securityOf('https://github.com/e2sy').kind === 'secure' && securityOf('https://github.com/e2sy').host === 'github.com', 'https classified secure with host')
ok(securityOf('http://neverssl.com/').kind === 'insecure', 'http classified insecure')
ok(securityOf('aether://settings').kind === 'internal', 'aether:// classified internal')
ok(securityOf('aether://downloads').host === 'downloads', 'internal page host parsed')
ok(securityOf('file:///C:/Users/x/doc.pdf').kind === 'file', 'file:// classified file')
ok(securityOf('about:blank').kind === 'internal', 'about: internal')
ok(securityOf('').kind === 'unknown' && securityOf('').host === '', 'empty url unknown, no throw')
ok(securityOf('garbage-not-a-url').kind === 'unknown', 'garbage unknown, no throw')
ok(securityOf('ftp://files.example.com').kind === 'unknown', 'ftp unknown (not web)')
ok(SECURITY_LABEL.secure.length > 10 && SECURITY_LABEL.insecure.length > 10, 'security labels present')

console.log('\n[10] private windows — snapshot exclusion (mixed case)')
const snapMixed = snapshotFromEntries([
  fakeEntry([{ url: 'https://public.com' }], 1),
  fakeEntry([{ url: 'https://secret.com', pinned: true }], 1, { private: true }),
  fakeEntry([{ url: 'https://also-public.com' }], 1)
])
ok(snapMixed.windows.length === 2, 'mixed entries: only public windows persist')
ok(!JSON.stringify(snapMixed).includes('secret.com'), 'private URLs never leak into the snapshot')
const snapPrivActive = snapshotFromEntries([fakeEntry([{ url: 'https://x.com' }], 1, { private: true })])
ok(snapPrivActive.windows.length === 0, 'private-only session writes nothing')

console.log(`\nv1.5.0 build 5 (private windows): ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
