#!/usr/bin/env node
/**
 * v2.10.0 build 24 — "Start cooking" wave:
 *   Side panels: pin any site into a docked side view (rail + panelhost +
 *   per-window dock state + panels.json), OS media keys (SMTC/MPRIS feature
 *   switches), memory-saver visibility (task manager sleeping/unloaded rows)
 *
 * Coverage:
 *  - shared/panels.ts — FUNCTIONAL bundle: url/title cleaning, make/dedupe/
 *    cap/sanitize, glyphs (hostile inputs included)
 *  - main/panelhost.ts — FUNCTIONAL bundle: panelSplit layout math (rail/
 *    panel/vtabs/narrow-window clamps) + open/close/toggle/switch lifecycle
 *    against a fake WebContentsView (reuse without reload, window-open →
 *    new tab, private partition, destroy-on-close) + railVisible via the
 *    real panels store on a temp dir
 *  - shared/taskmetrics.ts — hibernated flag passthrough + synthetic
 *    zero-cost rows for discarded tabs (kill target preserved, totals clean)
 *  - static wiring gates: ipc handlers + guards, preload bridge, windows.ts
 *    layout/cleanup, App/PanelRail/styles, menu accelerator, media-key boot
 *    switch (single combined enable-features), settings page, package chain
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireCjs = createRequire(import.meta.url)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outdir = path.join(ROOT, '.test-v2100-tmp')
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
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf-8')

/** Bundle a main/shared module to CJS under `outdir`, stubbing electron. */
async function bundleMain(rel, outfile, extraStub = '') {
  await build({
    entryPoints: [path.isAbsolute(rel) ? rel : path.join(ROOT, rel)],
    outfile: path.join(outdir, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['jsdom', '@mozilla/readability', 'turndown', 'electron-chrome-extensions'],
    plugins: [
      {
        name: 'stub-electron',
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron-stub', namespace: 'stub' }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `module.exports = { app: { getPath: () => ${JSON.stringify(outdir)}, getVersion: () => '0' }, ipcMain: { on() {}, handle() {} }, session: { defaultSession: {}, fromPartition: () => ({}) }${extraStub} }`,
            loader: 'js'
          }))
        }
      }
    ]
  })
  return requireCjs(path.join(outdir, outfile))
}

/* ============================ 1. shared/panels.ts ============================ */
section('shared/panels.ts: pure model')
let panels, panelhost, taskmetrics
{
  panels = await bundleMain('src/shared/panels.ts', 'panels-pure.cjs')
  const { cleanPanelUrl, cleanPanelTitle, makePanel, pushPanel, sanitizePanels, panelGlyph, MAX_PANELS } = panels

  ok(typeof cleanPanelUrl === 'function' && typeof makePanel === 'function', 'api surface exported')

  // url rules: http(s) only
  ok(cleanPanelUrl('https://example.com/a?b=1') === 'https://example.com/a?b=1', 'plain https kept')
  ok(cleanPanelUrl('http://example.com') === 'http://example.com/', 'http normalized by URL')
  ok(cleanPanelUrl('javascript:alert(1)') === '', 'javascript: rejected')
  ok(cleanPanelUrl('aether://settings') === '', 'aether:// rejected')
  ok(cleanPanelUrl('data:text/html,x') === '', 'data: rejected')
  ok(cleanPanelUrl('ftp://x.com') === '', 'ftp rejected')
  ok(cleanPanelUrl('not a url') === '', 'garbage rejected')
  ok(cleanPanelUrl('https://' + 'a'.repeat(2100) + '.com') === '', 'overlong url rejected')
  ok(cleanPanelUrl(null) === '' && cleanPanelUrl(42) === '', 'non-strings rejected')
  ok(cleanPanelUrl('  https://spaced.com  ') === 'https://spaced.com/', 'trimmed input accepted')

  // title rules
  ok(cleanPanelTitle('  Hi \u0007 there ') === 'Hi  there', 'control chars stripped')
  ok(cleanPanelTitle('x'.repeat(99)).length === 40, 'title capped at 40')
  ok(cleanPanelTitle(undefined) === '', 'non-string title -> empty')

  // makePanel
  const p1 = makePanel('https://news.ycombinator.com', '')
  ok(!!p1 && /^pn_[a-f0-9]{12}$/.test(p1.id), 'id shape pn_+12hex')
  ok(p1.title === 'news.ycombinator.com', 'host fallback title')
  ok(makePanel('javascript:x', 'y') === null, 'unusable url -> null panel')
  const p2 = makePanel('https://example.org', 'My News')

  // pushPanel: dedupe by URL first wins, newest front, cap
  let list = []
  list = pushPanel(list, p1)
  const dup = makePanel('https://news.ycombinator.com', 'Different title')
  list = pushPanel(list, dup)
  ok(list.length === 1 && list[0].id === p1.id, 'url dedupe keeps first')
  list = pushPanel(list, p2)
  ok(list[0].id === p2.id, 'newest at front')
  for (let i = 0; i < MAX_PANELS + 4; i++) list = pushPanel(list, makePanel(`https://site-${i}.com`, ''))
  ok(list.length === MAX_PANELS, `cap at ${MAX_PANELS}`)

  // sanitize: hostile disk payloads
  ok(sanitizePanels(null).length === 0, 'non-array -> []')
  ok(sanitizePanels([null, 42, 'x', {}]).length === 0, 'junk entries dropped')
  ok(sanitizePanels([{ id: 'not-valid', url: 'https://a.com' }]).length === 0, 'bad id dropped')
  ok(sanitizePanels([{ id: 'pn_abcdef123456', url: 'javascript:x' }]).length === 0, 'bad url dropped')
  ok(
    sanitizePanels([
      { id: 'pn_abcdef123456', url: 'https://clean1.com', title: 'T1', ts: 'nope' },
      { id: 'pn_abcdef123456', url: 'https://clean1.com/', title: '', ts: 5 }
    ]).length === 1,
    'dup urls in disk payload collapse'
  )
  const sane = sanitizePanels([{ id: 'pn_abcdef123456', url: 'https://clean1.com', title: '', ts: 'nope' }])[0]
  ok(sane.title === 'clean1.com' && sane.ts === 0, 'host fallback + ts coerce')

  ok(panelGlyph('https://mail.google.com/u/0') === 'M', 'glyph from host initial')
  ok(panelGlyph('not a url') === '?', 'glyph safe fallback')
}

/* ============================ 2. main/panels.ts store ============================ */
section('main/panels.ts: JsonStore round-trip')
{
  const store = await bundleMain('src/main/panels.ts', 'panels-store.cjs')
  ok(typeof store.listPanels === 'function' && typeof store.addPanel === 'function', 'store api exported')
  const a = store.addPanel('https://panel-store-test.com', 'PST')
  ok(!!a && a.id.startsWith('pn_'), 'addPanel returns panel')
  ok(store.listPanels().some((p) => p.url === 'https://panel-store-test.com/'), 'panel listed (url normalized with trailing slash)')
  ok(store.addPanel('https://panel-store-test.com', 'again') === null || !store.listPanels().some((p) => p.title === 'again'), 'add dedupes by url')
  ok(store.renamePanel(a.id, 'Renamed!') === true, 'rename works')
  ok(store.listPanels().find((p) => p.id === a.id).title === 'Renamed!', 'rename persisted')
  ok(store.renamePanel('pn_nope', 'x') === false, 'rename unknown -> false')
  ok(store.removePanel(a.id) === true, 'remove works')
  ok(store.removePanel(a.id) === false, 'remove twice -> false')
  ok(store.addPanel('javascript:x', 'evil') === null, 'addPanel rejects bad urls')
  // JsonStore.save is debounced (250ms) — let it flush so the next section's
  // bundle reads a CLEAN panels.json from disk
  await new Promise((r) => setTimeout(r, 400))
}

/* ============ 3+4. panelhost: layout math + lifecycle (one shared bundle) ============ */
section('main/panelhost.ts: panelSplit layout math')
{
  // one combined entry so panelhost and its panels store share ONE instance
  // (no disk handoff, no debounce races between assertions)
  const entryTs = path.join(outdir, 'panelhost-entry.ts')
  writeFileSync(
    entryTs,
    `export { panelSplit, railVisible, openPanel, closePanel, togglePanel, toggleLastPanel, applyPanelBounds, destroyPanelViews, getPanelState, PANEL_RAIL_WIDTH, PANEL_VIEW_WIDTH, MIN_CONTENT_WIDTH } from '${ROOT}/src/main/panelhost';\n` +
      `export { listPanels, addPanel, renamePanel, removePanel } from '${ROOT}/src/main/panels';\n`
  )
  // start from a clean disk state regardless of the flush above
  try {
    rmSync(path.join(outdir, 'panels.json'), { force: true })
  } catch {
    /* fine */
  }
  panelhost = await bundleMain(entryTs, 'panelhost.cjs', `,
    WebContentsView: class FakeView {
      constructor(opts) { this.opts = opts; this.webContents = new (class FakeWC {
        constructor() { this.url = ''; this.destroyed = false; this.loads = 0; this.openHandler = null }
        getURL() { return this.url }
        isDestroyed() { return this.destroyed }
        loadURL(u) { this.url = u; this.loads++; return Promise.resolve() }
        setWindowOpenHandler(h) { this.openHandler = h }
        close() { this.destroyed = true }
        on() {}
      })() }
      setBounds(b) { this.bounds = b }
      getBounds() { return this.bounds }
    }`)
  const { panelSplit, PANEL_RAIL_WIDTH, PANEL_VIEW_WIDTH, MIN_CONTENT_WIDTH } = panelhost

  // nothing showing: content starts after vtabs only
  let s = panelSplit({ w: 1280, h: 800, chromeH: 84, vtabs: 0, rail: false, panelOpen: false })
  ok(s.contentX === 0 && s.contentW === 1280 && s.panel === null, 'no rail no panel: content full')

  // rail only
  s = panelSplit({ w: 1280, h: 800, chromeH: 84, vtabs: 0, rail: true, panelOpen: false })
  ok(s.contentX === PANEL_RAIL_WIDTH && s.contentW === 1280 - PANEL_RAIL_WIDTH, 'rail insets content')

  // rail + panel
  s = panelSplit({ w: 1280, h: 800, chromeH: 84, vtabs: 0, rail: true, panelOpen: true })
  ok(s.contentX === PANEL_RAIL_WIDTH, 'panel starts after rail')
  ok(s.panel.x === PANEL_RAIL_WIDTH && s.panel.y === 84, 'panel rect anchored at rail/chrome')
  ok(s.panel.width === PANEL_VIEW_WIDTH, 'panel uses full width on a wide window')
  ok(s.contentW === 1280 - PANEL_RAIL_WIDTH - PANEL_VIEW_WIDTH, 'content loses rail+panel')

  // vtabs interplay
  s = panelSplit({ w: 1280, h: 800, chromeH: 84, vtabs: 224, rail: true, panelOpen: true })
  ok(s.contentX === 224 + PANEL_RAIL_WIDTH, 'vtabs+rail inset content')
  ok(s.panel.x === 224 + PANEL_RAIL_WIDTH, 'panel after vtabs too')

  // narrow window: panel shrinks, content keeps MIN_CONTENT_WIDTH
  s = panelSplit({ w: 500, h: 800, chromeH: 84, vtabs: 0, rail: true, panelOpen: true })
  ok(s.panel.width === 500 - PANEL_RAIL_WIDTH - MIN_CONTENT_WIDTH, 'panel shrinks on narrow windows')
  ok(s.contentW >= MIN_CONTENT_WIDTH, 'content keeps its minimum')

  // absurd narrow: clamp floors at 120 for the panel, 60 for content
  s = panelSplit({ w: 100, h: 800, chromeH: 84, vtabs: 400, rail: true, panelOpen: true })
  ok(s.panel.width >= 120, 'panel width floors at 120')
  ok(s.contentW >= 60, 'content width floors at 60')

  // hostile inputs do not throw
  s = panelSplit({ w: NaN, h: undefined, chromeH: -5, vtabs: 99999, rail: true, panelOpen: true })
  ok(Number.isFinite(s.contentX) && Number.isFinite(s.contentW), 'non-finite inputs clamped')
  ok(panelSplit({ w: 1280, h: 800, chromeH: 84, vtabs: 99999, rail: false, panelOpen: false }).contentX === 400, 'vtabs clamp at 400')
}

/* ============================ 4. panelhost lifecycle (fake views) ============================ */
section('main/panelhost.ts: open/close/toggle/destroy lifecycle')
{
  const { openPanel, closePanel, togglePanel, toggleLastPanel, applyPanelBounds, destroyPanelViews, railVisible, getPanelState, addPanel, removePanel } = panelhost

  // empty store -> rail hidden
  ok(railVisible(undefined) === false, 'rail hidden with no panels')

  const added = addPanel('https://lifecycle-test.com', 'Life')
  ok(!!added, 'panel added for lifecycle test')
  ok(railVisible(undefined) === true, 'rail visible with >=1 panel')

  function fakeEntry(winId, priv = false) {
    const kids = []
    const sends = []
    const created = []
    return {
      win: {
        id: winId,
        isDestroyed: () => false,
        getContentSize: () => [1280, 800],
        contentView: {
          addChildView: (v) => kids.push(v),
          removeChildView: (v) => {
            const i = kids.indexOf(v)
            if (i >= 0) kids.splice(i, 1)
          }
        },
        webContents: { send: (ch, payload) => sends.push([ch, payload]) }
      },
      tabs: { create: (url) => created.push(url) },
      ui: { sidebarOpen: false, vtabWidth: 0, panelOpenId: null },
      chromeH: 84,
      private: priv,
      __kids: kids,
      __sends: sends,
      __created: created
    }
  }

  const entry = fakeEntry(101)
  ok(openPanel(entry, 'pn_missing') === false, 'unknown panel id refused')
  ok(entry.ui.panelOpenId === null, 'nothing docked on refusal')

  ok(openPanel(entry, added.id) === true, 'openPanel succeeds')
  ok(entry.ui.panelOpenId === added.id, 'dock state recorded')
  ok(entry.__kids.length === 1, 'view added to contentView')
  ok(entry.__kids[0].webContents.url === 'https://lifecycle-test.com/', 'panel loaded its url')
  ok(entry.__kids[0].bounds && entry.__kids[0].bounds.width === 360 && entry.__kids[0].bounds.y === 84, 'panel bounds applied')
  ok(entry.__kids[0].bounds.x === 44, 'panel x insets by the 44px rail')
  ok(entry.__sends.some(([ch, pl]) => ch === 'panels:state' && pl.openId === added.id), 'panels:state pushed')
  const firstView = entry.__kids[0]

  // re-open same id: no duplicate child, no reload
  const loadsBefore = entry.__kids[0].webContents.loads
  ok(openPanel(entry, added.id) === true && entry.__kids.length === 1, 're-open does not duplicate view')
  ok(entry.__kids[0].webContents.loads === loadsBefore, 're-open does not reload')

  // second panel: switching hides the first (kept alive)
  const added2 = addPanel('https://lifecycle-two.com', 'Two')
  ok(openPanel(entry, added2.id) === true, 'second panel opens')
  ok(entry.__kids.length === 1, 'only one panel docked at a time')
  ok(entry.__kids[0].webContents.url === 'https://lifecycle-two.com/', 'switched panel is visible')
  ok(entry.ui.panelOpenId === added2.id, 'dock state switched')

  // window-open handler: popups become tabs of the hosting window
  const host = entry.__kids[0]
  ok(typeof host.webContents.openHandler === 'function', 'window-open handler wired')
  const verdict = host.webContents.openHandler({ url: 'https://popup.com/x' })
  ok(verdict && verdict.action === 'deny' && entry.__created[0] === 'https://popup.com/x', 'popup -> deny + foreground tab')

  // close: view survives (kept alive for instant reopen)
  ok(closePanel(entry) === true, 'closePanel ok')
  ok(entry.ui.panelOpenId === null && entry.__kids.length === 0, 'docked view removed on close')
  ok(closePanel(entry) === false, 'close twice -> false')

  // reopen: SAME view reused, no reload
  const loadsBefore2 = firstView.webContents.loads
  ok(togglePanel(entry, added.id) === true, 'togglePanel opens')
  ok(entry.__kids.length === 1 && entry.__kids[0] === firstView, 'same view instance reused')
  ok(firstView.webContents.loads === loadsBefore2, 'reuse does not reload')
  ok(togglePanel(entry, added.id) === true, 'toggle closes and reports true')
  ok(entry.ui.panelOpenId === null, 'toggle closed it')

  // private windows: panel view uses the private partition, no bridge preload
  const priv = fakeEntry(102, true)
  ok(openPanel(priv, added.id) === true, 'panel opens in private window')
  ok(priv.__kids[0].opts.webPreferences.partition === 'aether-private', 'private partition used')
  ok(priv.__kids[0].opts.webPreferences.preload === undefined, 'no aether bridge preload in panels')
  ok(priv.__kids[0].opts.webPreferences.sandbox === true, 'panel views sandboxed')
  destroyPanelViews(priv)
  ok(priv.__kids[0].webContents.destroyed === true, 'destroyPanelViews closes webContents')

  // toggleLastPanel: closes when open, opens newest when closed
  const entry3 = fakeEntry(103)
  ok(toggleLastPanel(entry3) === true, 'toggleLastPanel opens newest pinned panel')
  ok(entry3.ui.panelOpenId === added2.id, 'newest panel (list front) opened')
  ok(toggleLastPanel(entry3) === true, 'toggleLastPanel closes when open')

  // removal while docked is handled by ipc (windows loop) — check state getter
  ok(getPanelState(entry3).openId === null, 'getPanelState null after close')
  removePanel(added.id)
  removePanel(added2.id)
}

/* ============================ 5. taskmetrics: sleeping/unloaded rows ============================ */
section('shared/taskmetrics.ts: hibernated + discarded rows')
{
  taskmetrics = await bundleMain('src/shared/taskmetrics.ts', 'taskmetrics.cjs')
  const { mapTaskMetrics } = taskmetrics
  const metrics = [
    { pid: 10, type: 'Renderer', cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 50000 } },
    { pid: 20, type: 'Renderer', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 100000 } }
  ]
  const tabs = [
    { winId: 1, tabId: 1, title: 'Live tab', url: 'https://live.com', pid: 10 },
    { winId: 1, tabId: 2, title: 'Sleeper', url: 'https://sleep.com', pid: 20, hibernated: true },
    { winId: 1, tabId: 3, title: 'Ghost', url: 'https://ghost.com', pid: undefined, discarded: true }
  ]
  const snap = mapTaskMetrics(metrics, tabs, {}, Date.now())
  const sleeper = snap.rows.find((r) => r.label === 'Sleeper')
  ok(!!sleeper && sleeper.hibernated === true, 'hibernated flag reaches the row')
  const ghost = snap.rows.find((r) => r.label === 'Ghost')
  ok(!!ghost && ghost.discarded === true && ghost.memBytes === 0 && ghost.cpuPct === 0, 'discarded tab gets a synthetic zero-cost row')
  ok(!!ghost.kill && ghost.kill.tabId === 3, 'discarded row keeps its kill target')
  ok(snap.totalMemBytes === (50000 + 100000) * 1024, 'totals unchanged by synthetic rows')
  ok(snap.rows[snap.rows.length - 1].memBytes === 0, 'zero-cost rows sort last')
  const snap2 = mapTaskMetrics(metrics, tabs.filter((t) => !t.discarded), {}, Date.now())
  ok(!snap2.rows.some((r) => r.discarded), 'no synthetic rows without discarded refs')
}

/* ============================ 6. wiring gates ============================ */
section('wiring gates: ipc / preload / windows / renderer / menu / media keys')
{
  const ipcSrc = read('src/main/ipc.ts')
  for (const ch of ['panels:list', 'panels:add', 'panels:rename', 'panels:remove', 'panels:open', 'panels:close', 'panels:getState']) {
    ok(ipcSrc.includes(`'${ch}'`), `ipc handler ${ch} registered`)
    ok(new RegExp(`ipcMain\\.handle\\('${ch.replace(/:/g, '\\:')}'[\\s\\S]{0,80}?guard\\(e, '${ch.replace(/:/g, '\\:')}'\\)`).test(ipcSrc), `${ch} is guarded`)
  }
  ok(ipcSrc.includes("entry.ui.panelOpenId === pid"), 'panels:remove closes docked panels across windows')
  ok(ipcSrc.includes('broadcastPanelsChanged'), 'panel store changes broadcast to chrome windows')
  ok(ipcSrc.includes('discarded: true') && ipcSrc.includes('hibernated: true'), 'taskmgr refs carry sleeping flags')

  const preloadSrc = read('src/preload/api.ts')
  ok(preloadSrc.includes('panels: {'), 'preload panels group present')
  ok(preloadSrc.includes("subscribe('panels:state')") && preloadSrc.includes("subscribe('panels:changed')"), 'preload panel subscriptions present')

  const winSrc = read('src/main/windows.ts')
  ok(winSrc.includes('panelOpenId: string | null'), 'WindowEntry.ui.panelOpenId typed')
  ok(winSrc.includes('panelOpenId: null'), 'panelOpenId initialized')
  ok(winSrc.includes('panelSplit(') && winSrc.includes('applyPanelBounds(entry)'), 'applyLayout reserves rail+panel and positions the view')
  ok(winSrc.includes('destroyPanelViews(entry)'), 'panel views destroyed with the window')

  const railSrc = read('src/renderer/src/components/PanelRail.tsx')
  ok(railSrc.includes('window.aether.panels') && railSrc.includes('.add(u') && railSrc.includes('panels.open(') && railSrc.includes('panels.remove('), 'PanelRail wired to the bridge')
  ok(railSrc.includes('onPanelState') && railSrc.includes('onPanelsChanged'), 'PanelRail subscribes to panel events')
  const appSrc = read('src/renderer/src/App.tsx')
  ok(appSrc.includes('<PanelRail />') && appSrc.includes('panels-on'), 'App mounts the rail behind panels-on')
  const cssSrc = read('src/renderer/src/styles.css')
  ok(cssSrc.includes('.panels-rail') && cssSrc.includes('.app.panels-on'), 'rail styles present')

  const menuSrc = read('src/main/menu.ts')
  ok(menuSrc.includes("'Toggle Side Panel'") && menuSrc.includes('CmdOrCtrl+Alt+P'), 'View menu has the side-panel accelerator')
  ok(menuSrc.includes("from './panelhost'"), 'menu wires toggleLastPanel')

  const indexSrc = read('src/main/index.ts')
  ok(indexSrc.includes("'HardwareMediaKeyHandling'") && indexSrc.includes("'MediaSessionService'"), 'media-key feature switches present')
  const enableFeatureAppends = (indexSrc.match(/appendSwitch\('enable-features'/g) || []).length
  ok(enableFeatureAppends === 1, `exactly ONE combined enable-features append (found ${enableFeatureAppends})`)
  ok(indexSrc.includes("features.push('DnsOverHttps')"), 'DoH feature rides the same combined switch')

  const typesSrc = read('src/shared/types.ts')
  const storeSrc = read('src/main/store.ts')
  const pagesSrc = read('src/main/pages.ts')
  ok(typesSrc.includes('mediaKeys: boolean'), 'Settings type has mediaKeys')
  ok(storeSrc.includes('mediaKeys: true'), 'mediaKeys defaults ON')
  ok(pagesSrc.includes("id=\"mediaKeys\"") && pagesSrc.includes("save({ mediaKeys: e.target.checked })"), 'settings page has the mediaKeys toggle + save')
  ok(pagesSrc.includes("' · sleeping'") && pagesSrc.includes("' · unloaded'"), 'taskmgr shows sleeping/unloaded badges')
  ok(pagesSrc.includes('unloaded (0 MB)'), 'taskmgr summary counts unloaded tabs')

  const tmSrc = read('src/shared/taskmetrics.ts')
  ok(tmSrc.includes('hibernated?: boolean') && tmSrc.includes('discarded?: boolean'), 'taskmetrics types extended')
  ok(tmSrc.includes('syntheticPid'), 'synthetic rows emitted for discarded tabs')

  const pkg = JSON.parse(read('package.json'))
  ok(pkg.version === '2.10.0', 'package.json version 2.10.0')
  ok((pkg.scripts.test || '').includes('test-v2100.mjs'), 'test chain includes test-v2100')
}

/* ============================ done ============================ */
console.log(`\n${'='.repeat(46)}`)
console.log(`v2100: ${pass} passed, ${fail} failed`)
try {
  rmSync(outdir, { recursive: true, force: true })
} catch {
  /* windows lock */
}
process.exit(fail ? 1 : 0)
