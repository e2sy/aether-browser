#!/usr/bin/env node
/**
 * v2.8.0 build 22 — Browsing-flow wave:
 *   Mouse gestures (Dolphin-style right-drag navigation, plain-JS preload)
 *   Speed dial (user-pinned New Tab tiles + "Add to speed dial" menu action)
 *   De-amping (AMP-cache URLs rewritten to publisher pages, #104)
 *   Copy-link scrubbing (copied addresses never carry tracking params)
 *   CI: macOS leg continues-on-error (GitHub infra zero-step cancellations)
 *
 * Coverage:
 *  - shared/gestures.ts (trail→sequence math, action map, payload sanitize)
 *  - shared/dials.ts (url/title cleaning, dedupe, cap, fail-closed sanitize)
 *  - preload/gesture.js — FUNCTIONAL: executed under node with stubbed DOM
 *    globals; verifies detection, emitter wiring, context-menu suppression,
 *    and the settings-off gate
 *  - main/privacy.ts deAmpUrl matrix
 *  - static wiring gates across main/preload/renderer/pages/CI
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireCjs = createRequire(import.meta.url)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outdir = path.join(ROOT, '.test-v280-tmp')
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

async function bundleMain(rel, external = [], stubElectron = false) {
  const plugins = []
  if (stubElectron) {
    // main modules pull in electron + the JsonStore at import time — feed
    // them a minimal stub so the bundle can load under plain node
    plugins.push({
      name: 'stub-electron',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron-stub', namespace: 'stub' }))
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: `module.exports = { app: { getPath: () => ${JSON.stringify(outdir)} }, ipcMain: { on() {} }, session: { defaultSession: {}, fromPartition: () => ({}) } }`,
          loader: 'js'
        }))
      }
    })
  }
  const { outputFiles } = await build({
    entryPoints: [path.join(ROOT, 'src', rel)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external,
    plugins,
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

/* ── shared/gestures.ts ───────────────────────────────────────────────────── */
section('gestures: trail → sequence math')
const gestures = await bundleMain('shared/gestures.ts')
{
  const pt = (x, y) => ({ x, y })
  // simple right drag
  ok(gestures.seqFromTrail([pt(0, 0), pt(10, 0), pt(50, 2)]) === 'R', 'right drag → R')
  ok(gestures.seqFromTrail([pt(50, 0), pt(10, 0)]) === 'L', 'left drag → L')
  ok(gestures.seqFromTrail([pt(0, 0), pt(0, 60)]) === 'D', 'down drag → D')
  ok(gestures.seqFromTrail([pt(0, 0), pt(0, -60)]) === 'U', 'up drag → U')
  // below threshold → nothing
  ok(gestures.seqFromTrail([pt(0, 0), pt(10, 0), pt(20, 0)]) === '', 'sub-threshold wiggle → empty')
  // down then up (reload)
  ok(gestures.seqFromTrail([pt(0, 0), pt(0, 60), pt(0, 0)]) === 'DU', 'down-up → DU')
  // up then down (reopen closed)
  ok(gestures.seqFromTrail([pt(0, 0), pt(0, -60), pt(0, 0)]) === 'UD', 'up-down → UD')
  // diagonal dominance: mostly right with slight down → R, not D
  ok(gestures.seqFromTrail([pt(0, 0), pt(80, 30)]) === 'R', 'diagonal → dominant axis')
  // two separate moves
  ok(gestures.seqFromTrail([pt(0, 0), pt(80, 0), pt(80, 70)]) === 'RD', 'two segments → RD')
  // junk inputs
  ok(gestures.seqFromTrail(null) === '', 'null trail → empty')
  ok(gestures.seqFromTrail('x') === '', 'string trail → empty')
  ok(gestures.seqFromTrail([pt(NaN, 0), pt(1, 1)]) === '', 'NaN coords ignored')
  ok(gestures.seqFromTrail([pt(Infinity, 0), pt(1, 1)]) === '', 'Infinity coords ignored')
  ok(gestures.seqFromTrail([pt(0, 0)]) === '', 'single point → empty')
  // scribble guard: cap at 3 segments
  const long = []
  for (let i = 0; i <= 40; i++) long.push(pt(i * 40, (i % 2) * 60))
  ok(gestures.seqFromTrail(long).length <= gestures.MAX_GESTURE_LEN, 'sequence capped at MAX_GESTURE_LEN')

  // action map
  ok(gestures.actionForSeq('L') === 'back', 'L → back')
  ok(gestures.actionForSeq('R') === 'forward', 'R → forward')
  ok(gestures.actionForSeq('U') === 'newTab', 'U → newTab')
  ok(gestures.actionForSeq('D') === 'closeTab', 'D → closeTab')
  ok(gestures.actionForSeq('DU') === 'reload', 'DU → reload')
  ok(gestures.actionForSeq('UD') === 'reopenClosed', 'UD → reopenClosed')
  ok(gestures.actionForSeq('XX') === null, 'unknown seq → null')
  ok(gestures.actionForSeq('') === null, 'empty seq → null')
  ok(gestures.actionForSeq('constructor') === null, 'prototype key → null (no proto leaks)')

  // payload sanitize
  ok(gestures.sanitizeGesturePayload(null) === null, 'null payload → null')
  ok(gestures.sanitizeGesturePayload({}) === null, 'trail-less payload → null')
  ok(gestures.sanitizeGesturePayload({ trail: [pt(0, 0), pt(0, 60)] })?.seq === 'D', 'valid payload passes')
  const hostile = gestures.sanitizeGesturePayload({ seq: 'U', trail: [pt(0, 0), pt(0, -60), 'junk', {}, pt(1, 1)] })
  ok(hostile && hostile.seq === 'UD' && hostile.trail.length === 3, 'hostile entries filtered, seq recomputed from valid points')
}

/* ── shared/dials.ts ──────────────────────────────────────────────────────── */
section('dials: url/title cleaning + registry rules')
const dials = await bundleMain('shared/dials.ts')
{
  ok(dials.cleanDialUrl('https://example.com/a?b=1') === 'https://example.com/a?b=1', 'https accepted')
  ok(dials.cleanDialUrl('http://example.com') === 'http://example.com/', 'http normalized')
  ok(dials.cleanDialUrl('javascript:alert(1)') === '', 'javascript: rejected')
  ok(dials.cleanDialUrl('aether://settings') === '', 'aether: rejected')
  ok(dials.cleanDialUrl('data:text/html,x') === '', 'data: rejected')
  ok(dials.cleanDialUrl('ftp://example.com') === '', 'ftp rejected')
  ok(dials.cleanDialUrl('') === '' && dials.cleanDialUrl(null) === '', 'empty/null rejected')
  ok(dials.cleanDialUrl('https://example.com/' + 'x'.repeat(3000)) === '', 'oversized url rejected')

  ok(dials.cleanDialTitle('  My Site  ') === 'My Site', 'title trimmed')
  ok(dials.cleanDialTitle('a\u0000b') === 'ab', 'control chars stripped')
  ok(dials.cleanDialTitle('x'.repeat(100)).length === dials.MAX_DIAL_TITLE, 'title clamped')

  const dial = dials.makeDial('https://www.example.com/page', '  Example ')
  ok(dial && /^dl_[a-f0-9]{12}$/.test(dial.id), 'dial id format')
  ok(dial && dial.url === 'https://www.example.com/page', 'dial url kept')
  ok(dial && dial.title === 'Example', 'dial title cleaned')
  ok(dials.makeDial('not-a-url', 'x') === null, 'bad url → null dial')
  const noTitle = dials.makeDial('https://example.com/x', '   ')
  ok(noTitle && noTitle.title === 'example.com', 'empty title falls back to host')

  // dedupe: first wins (re-pinning never duplicates), newest prepended, cap 16
  let list = dials.pushDial([], { id: 'dl_aaaaaaaaaaaa', url: 'https://a.com/', title: 'A', ts: 1 })
  list = dials.pushDial(list, { id: 'dl_bbbbbbbbbbbb', url: 'https://b.com/', title: 'B', ts: 2 })
  list = dials.pushDial(list, { id: 'dl_cccccccccccc', url: 'https://a.com/', title: 'A2', ts: 3 })
  ok(list.length === 2, 'no duplicate dial created')
  ok(list[0].url === 'https://b.com/' && list[0].title === 'B', 'newest dial at the front')
  const a = list.find((x) => x.url === 'https://a.com/')
  ok(a && a.title === 'A' && a.id === 'dl_aaaaaaaaaaaa', 'existing dial kept untouched (first wins)')
  for (let i = 0; i < 30; i++) {
    list = dials.pushDial(list, { id: 'dl_x' + String(i).padStart(10, '0'), url: `https://s${i}.com/`, title: 'S', ts: i })
  }
  ok(list.length === dials.MAX_DIALS, 'dials capped at 16')

  // fail-closed sanitize from disk
  const raw = [
    { id: 'dl_aaaaaaaaaaaa', url: 'https://a.com/', title: 'A', ts: 1 },
    { id: 'BAD', url: 'https://b.com/', title: 'B', ts: 2 },
    { id: 'dl_cccccccccccc', url: 'javascript:alert(1)', title: 'evil', ts: 3 },
    { id: 'dl_dddddddddddd', url: 'https://d.com/', title: 'D', ts: 4 },
    { id: 'dl_dddddddddddd', url: 'https://d.com/', title: 'D-dup', ts: 5 },
    'junk',
    null
  ]
  const clean = dials.sanitizeDials(raw)
  ok(clean.length === 2, 'sanitize drops bad ids/evil urls/dupes/junk')
  ok(clean.some((x) => x.url === 'https://a.com/') && clean.some((x) => x.url === 'https://d.com/'), 'valid dials kept')
  ok(dials.sanitizeDials('nope').length === 0, 'non-array → empty')
  const noTitleDial = dials.sanitizeDials([{ id: 'dl_eeeeeeeeeeee', url: 'https://e.com/x', title: '', ts: 0 }])
  ok(noTitleDial.length === 1 && noTitleDial[0].title === 'e.com', 'missing title → host fallback')
}

/* ── main/privacy.ts — de-amp matrix ─────────────────────────────────────── */
section('privacy: deAmpUrl matrix')
const privacy = await bundleMain('main/privacy.ts', ['electron'])
{
  ok(
    privacy.deAmpUrl('https://cdn.ampproject.org/c/s/example.com/page?x=1#frag') ===
      'https://example.com/page?x=1#frag',
    'ampproject /c/s/ → https publisher'
  )
  ok(
    privacy.deAmpUrl('https://cdn.ampproject.org/c/example.com/page') === 'http://example.com/page',
    'ampproject /c/ (insecure) → http publisher'
  )
  ok(
    privacy.deAmpUrl('https://www.google.com/amp/s/www.wired.com/story/x') === 'https://www.wired.com/story/x',
    'google /amp/s/ wrapper → publisher'
  )
  ok(
    privacy.deAmpUrl('https://www.google.de/amp/s/amp.theguardian.com/env') === 'https://amp.theguardian.com/env',
    'google TLD variant handled'
  )
  ok(privacy.deAmpUrl('https://example.com/article/amp/') === 'https://example.com/article/', 'trailing /amp/ stripped')
  ok(privacy.deAmpUrl('https://example.com/article/amp') === 'https://example.com/article/', 'trailing /amp stripped')
  ok(privacy.deAmpUrl('https://example.com/article/amp.html') === 'https://example.com/article/', 'amp.html stripped')
  ok(privacy.deAmpUrl('https://example.com/x?amp=1&id=2') === 'https://example.com/x?id=2', 'amp param dropped, rest kept')
  ok(privacy.deAmpUrl('https://example.com/x?amp=1') === 'https://example.com/x', 'amp param alone → no query')
  // no-ops
  ok(privacy.deAmpUrl('https://example.com/page') === null, 'plain url → null')
  ok(privacy.deAmpUrl('https://example.com/sample') === null, '/sample not treated as /amp')
  ok(privacy.deAmpUrl('http://localhost:3000/amp') === null, 'localhost never touched')
  ok(privacy.deAmpUrl('aether://settings') === null, 'internal scheme → null')
  ok(privacy.deAmpUrl('not a url') === null, 'garbage → null')
  // loop safety: output of de-amp is stable (null on second pass)
  const once = privacy.deAmpUrl('https://cdn.ampproject.org/c/s/example.com/p')
  ok(once === 'https://example.com/p' && privacy.deAmpUrl(once) === null, 'de-amp is idempotent (no redirect loops)')
  // existing scrubber untouched
  ok(
    privacy.stripTrackingParams('https://a.com/?utm_source=x&id=1') === 'https://a.com/?id=1',
    'param scrubber still strips utm'
  )
}

/* ── preload/gesture.js — FUNCTIONAL (stubbed DOM, node-executed) ────────── */
section('gesture.js: enabled detection (functional)')

function installWindowStub() {
  const listeners = {}
  const stub = {
    addEventListener(type, fn) {
      ;(listeners[type] = listeners[type] || []).push(fn)
    },
    __aetherTestListeners() {
      return listeners
    },
    dispatch(type, ev) {
      const evt = {
        button: 0,
        clientX: 0,
        clientY: 0,
        prevented: false,
        ...ev,
        preventDefault() {
          this.prevented = true
        },
        stopPropagation() {}
      }
      for (const fn of listeners[type] || []) fn(evt)
      return evt
    },
    __listeners: listeners
  }
  return stub
}

function loadGestureJs(windowStub, configEnv) {
  // each load needs a fresh module instance → unique query suffix
  const file = path.join(outdir, `gesture-${Math.random().toString(36).slice(2)}.js`)
  writeFileSync(file, read('src/preload/gesture.js'))
  delete requireCjs.cache[file]
  const prevConfig = process.env.AETHER_GESTURE_TEST_CONFIG
  process.env.AETHER_GESTURE_TEST_CONFIG = configEnv
  globalThis.window = windowStub
  const mod = requireCjs(file)
  if (prevConfig === undefined) delete process.env.AETHER_GESTURE_TEST_CONFIG
  else process.env.AETHER_GESTURE_TEST_CONFIG = prevConfig
  delete globalThis.window
  return mod
}

{
  const win = installWindowStub()
  process.env.AETHER_GESTURE_TEST = '1'
  const sent = []
  const g = loadGestureJs(win, '{"enabled":true}')
  ok(g.enabled === true, 'enabled config honored')
  ok(g.installed === true, 'detector installed on window')
  ok(Array.isArray(g.listeners.mousedown) && g.listeners.mousedown.length > 0, 'mousedown listener registered')
  g._setEmitter((payload) => sent.push(payload))

  // left-button drag → nothing
  win.dispatch('mousedown', { button: 0, clientX: 0, clientY: 0 })
  win.dispatch('mousemove', { clientX: 90, clientY: 0 })
  win.dispatch('mouseup', { button: 0, clientX: 90, clientY: 0 })
  ok(sent.length === 0, 'left-button drag never fires a gesture')

  // plain right-click (no movement) → no gesture, no menu suppression
  const ctx1 = win.dispatch('contextmenu', { button: 2 })
  ok(ctx1.prevented === false, 'plain right-click keeps its context menu')

  // right drag → forward gesture (one long stroke = one segment)
  win.dispatch('mousedown', { button: 2, clientX: 0, clientY: 0 })
  win.dispatch('mousemove', { clientX: 100, clientY: 0 })
  win.dispatch('mouseup', { button: 2, clientX: 100, clientY: 0 })
  ok(sent.length === 1 && sent[0].seq === 'R', 'right drag emits seq R')
  ok(Array.isArray(sent[0].trail) && sent[0].trail.length === 3, 'trail attached to payload (mouseup point included)')
  const ctx2 = win.dispatch('contextmenu', { button: 2 })
  ok(ctx2.prevented === true, 'post-gesture context menu suppressed')
  const ctx3 = win.dispatch('contextmenu', { button: 2 })
  ok(ctx3.prevented === false, 'suppression is one-shot')

  // down-up → reload combo
  win.dispatch('mousedown', { button: 2, clientX: 0, clientY: 0 })
  win.dispatch('mousemove', { clientX: 0, clientY: 60 })
  win.dispatch('mousemove', { clientX: 0, clientY: 0 })
  win.dispatch('mouseup', { button: 2, clientX: 0, clientY: 0 })
  ok(sent.length === 2 && sent[1].seq === 'DU', 'down-up emits DU (reload)')
  ok(typeof g.collapse === 'function', 'collapse helper exposed')

  // suppression is one-shot: expires after its 350ms window
  await new Promise((r) => setTimeout(r, 400))
  const ctx4 = win.dispatch('contextmenu', { button: 2 })
  ok(ctx4.prevented === false, 'suppression expires (one-shot)')
}

section('gesture.js: disabled gate (functional)')
{
  const win = installWindowStub()
  process.env.AETHER_GESTURE_TEST = '1'
  const g = loadGestureJs(win, '{"enabled":false}')
  ok(g.enabled === false, 'disabled config honored')
  ok(g.installed === false, 'no detector installed when disabled')
  ok(!win.__listeners.mousedown && !win.__listeners.contextmenu, 'no listeners → right-click fully native')
}

/* ── main/gestures.ts — action dispatch ──────────────────────────────────── */
section('gestures runtime: runAction dispatch mapping')
{
  process.env.AETHER_GESTURE_TEST = '1'
  const gmod = await bundleMain('main/gestures.ts', [], true)
  const calls = []
  const fakeTm = {
    back: (id) => calls.push(['back', id]),
    forward: (id) => calls.push(['forward', id]),
    reload: (id) => calls.push(['reload', id]),
    create: () => calls.push(['create']),
    close: (id) => calls.push(['close', id]),
    reopenClosedTab: () => calls.push(['reopen'])
  }
  gmod.runAction(fakeTm, 7, 'back')
  gmod.runAction(fakeTm, 7, 'forward')
  gmod.runAction(fakeTm, 7, 'newTab')
  gmod.runAction(fakeTm, 7, 'closeTab')
  gmod.runAction(fakeTm, 7, 'reload')
  gmod.runAction(fakeTm, 7, 'reopenClosed')
  ok(
    JSON.stringify(calls) ===
      JSON.stringify([['back', 7], ['forward', 7], ['create'], ['close', 7], ['reload', 7], ['reopen']]),
    'all six actions route to the right TabManager calls'
  )
}

/* ── wiring gates ─────────────────────────────────────────────────────────── */
section('wiring: boot + sessions')
{
  const idx = read('src/main/index.ts')
  ok(idx.includes('initGestures('), 'index boots gesture IPC')
  ok(idx.includes('registerGestureEverywhere()'), 'index registers gesture preload on default+private')
  ok(idx.includes('tabIdForWebContents(wc)'), 'gesture router resolves sender tab')
  ok(/deAmp: mergedSettings\(\)\.deAmp !== false/.test(idx), 'default session privacy policy carries deAmp')

  const cnt = read('src/main/containers.ts')
  ok(cnt.includes('registerGestureOnSession(ses)'), 'container sessions get the gesture preload')
  ok(/deAmp: mergedSettings\(\)\.deAmp !== false/.test(cnt), 'container privacy policy carries deAmp')

  const tabs = read('src/main/tabs.ts')
  ok(tabs.includes('tabIdForWebContents(wc: Electron.WebContents): number | null'), 'TabManager exposes webContents→tab resolver')

  const vite = read('electron.vite.config.ts')
  ok(vite.includes("'farble.js', 'gesture.js'"), 'vite copies gesture.js next to farble.js')
}

section('wiring: IPC + bridge')
{
  const ipc = read('src/main/ipc.ts')
  for (const ch of ['dials:list', 'dials:add', 'dials:rename', 'dials:remove']) {
    ok(ipc.includes(`'${ch}'`), `ipc handler ${ch}`)
    ok(new RegExp(`'${ch}'[,(][\\s\\S]{0,120}guard\\(e, '${ch}'\\)`).test(ipc), `${ch} is guarded`)
  }
  ok(ipc.includes('dials: listDials()'), 'internal:startup serves dials to the New Tab page')

  const api = read('src/preload/api.ts')
  ok(api.includes('dials: {'), 'bridge exposes dials group')
  ok(api.includes("'dials:add', url, title") && api.includes("'dials:remove', id"), 'bridge dials channels wired')

  const trust = read('src/main/trust.ts')
  ok(trust.length > 0, 'trust module present (guards unchanged)')
}

section('wiring: menu + settings + pages')
{
  const menu = read('src/main/menu.ts')
  ok(menu.includes("'Copy link address'"), 'context menu has Copy link address')
  ok(menu.includes("'Add to speed dial'"), 'context menu has Add to speed dial')
  ok(menu.includes('stripTrackingParams(params.srcURL) || params.srcURL'), 'copy image address is scrubbed')
  ok(menu.includes('stripTrackingParams(raw) || raw'), 'copy link address is scrubbed')
  ok(menu.includes("addDial(pageUrl, wc.getTitle())"), 'speed dial add uses the live page url+title')

  const types = read('src/shared/types.ts')
  ok(types.includes('deAmp: boolean'), 'Settings.deAmp typed')
  ok(types.includes('gestures: boolean'), 'Settings.gestures typed')

  const store = read('src/main/store.ts')
  ok(store.includes('deAmp: true'), 'deAmp defaults on')
  ok(store.includes('gestures: true'), 'gestures default on')

  const pages = read('src/main/pages.ts')
  ok(pages.includes('SPEED DIAL'), 'new tab renders the speed dial section')
  ok(pages.includes("getElementById('dialform')"), 'new tab has the add-dial inline form')
  ok(pages.includes('renderDials(data.dials)'), 'startup data feeds the dial grid')
  ok(pages.includes("id=\"deAmp\""), 'settings page has the de-amp toggle')
  ok(pages.includes("id=\"gestures\""), 'settings page has the gestures toggle')
  ok(pages.includes("save({ deAmp: e.target.checked })"), 'de-amp toggle persists')
  ok(pages.includes("save({ gestures: e.target.checked })"), 'gestures toggle persists')
  ok(pages.includes("s.deAmp !== false") && pages.includes("s.gestures !== false"), 'toggles load with default-on')
}

section('wiring: CI + package')
{
  const yml = read('.github/workflows/build.yml')
  ok(
    yml.includes("continue-on-error: ${{ matrix.os == 'macos-latest' }}"),
    'macos legs continue-on-error (infra-flake unblock)'
  )
  ok(yml.split("continue-on-error: ${{ matrix.os == 'macos-latest' }}").length === 3, 'applied to test + release jobs')

  const pkg = JSON.parse(read('package.json'))
  ok(pkg.version === '2.8.0', 'package version 2.8.0')
  ok(pkg.scripts.test.includes('test-v280.mjs'), 'test chain includes test-v280')
}

console.log(`\n════════════════════════════════════════`)
console.log(`  test-v280: ${pass} passed, ${fail} failed`)
console.log(`════════════════════════════════════════`)
try {
  rmSync(outdir, { recursive: true, force: true })
} catch {
  /* windows file locks — best effort */
}
process.exit(fail === 0 ? 0 : 1)
