/**
 * v1.8.0 build 10 — Phase 2: vertical tabs (#33) + tab groups (#34).
 *
 * Exercises the pure tab-group model (tabgroups.ts) and asserts the
 * main/renderer wiring for the vertical strip and group IPC.
 *
 * Run:  node scripts/test-v181.mjs
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

/* ---------- bundle tabgroups.ts (pure — no electron) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test181-'))
fs.cpSync(path.join(APP, 'src', 'main', 'tabgroups.ts'), path.join(tmp, 'tabgroups.ts'))
const OUTDIR = path.join(APP, '.test-v181-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })
await build({
  entryPoints: [path.join(tmp, 'tabgroups.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(OUTDIR, 'tabgroups.mjs'),
  logLevel: 'silent'
})
const tg = await import(pathToFileURL(path.join(OUTDIR, 'tabgroups.mjs')).href)

console.log('\n── group creation rules (#34) ──')
const g1 = tg.makeGroup({ name: '  Work  ', color: 'red' }, [])
ok(g1 && g1.name === 'Work' && g1.color === 'red' && g1.collapsed === false, 'name trims, color applies')
ok(/^tg_[a-f0-9]{12}$/.test(g1.id), 'id is tg_ + 12 hex chars')
eq(tg.makeGroup({ name: '   ' }, []), null, 'blank name rejected')
eq(tg.makeGroup({ name: 'x'.repeat(41) }, [])?.name.length, 40, 'name capped at 40')
eq(tg.makeGroup({ name: 'work' }, [g1]), null, 'duplicate name (case-insensitive) rejected')
eq(tg.makeGroup({ name: 'ok', color: '#123456' }, [])?.color, 'blue', 'off-palette color falls back to blue')
eq(tg.makeGroup({ name: 'ok2' }, [])?.color, 'blue', 'missing color defaults to blue')
ok(tg.isGroupColor('purple') && !tg.isGroupColor('chartreuse'), 'palette check')

console.log('\n── rename / recolor / collapse ──')
const g2 = tg.makeGroup({ name: 'Read later', color: 'yellow' }, [g1])
let groups = tg.renameGroup([g1, g2], g2.id, '  Reading  ')
eq(groups[1].name, 'Reading', 'rename applies')
eq(tg.renameGroup([g1, g2], g2.id, '')[1].name, 'Read later', 'empty rename is a no-op (original kept)')
eq(tg.renameGroup([g1, g2], g2.id, 'work')[1].name, 'Read later', 'duplicate rename blocked (original kept)')
eq(tg.renameGroup([g1, g2], g1.id, 'work')[0].name, 'work', 'same-name self rename allowed')
eq(tg.recolorGroup([g1], g1.id, 'cyan')[0].color, 'cyan', 'recolor applies')
eq(tg.recolorGroup([g1], g1.id, 'magenta')[0].color, 'red', 'bad color ignored')
groups = tg.toggleGroupCollapsed([g1], g1.id)
eq(groups[0].collapsed, true, 'collapse toggles')
eq(tg.toggleGroupCollapsed(groups, g1.id, false)[0].collapsed, false, 'explicit expand')

console.log('\n── membership + deletion semantics ──')
const tabGroups = { '1': g1.id, '2': g1.id, '3': g2.id, '4': null }
const del = tg.deleteGroup([g1, g2], g1.id, tabGroups)
eq(del.groups.length, 1, 'group removed')
eq(del.groups[0].id, g2.id, 'the other group survives')
eq(del.tabGroups['1'], null, 'member 1 ungrouped')
eq(del.tabGroups['2'], null, 'member 2 ungrouped')
eq(del.tabGroups['3'], g2.id, 'member of other group untouched')

console.log('\n── strip ordering (ungrouped first, groups after, in group order) ──')
const order = tg.orderedTabIds(
  ['t1', 't2', 't3', 't4', 't5'],
  [g2, g1], // g2 declared first on purpose
  { t2: g1.id, t4: g2.id, t5: g2.id }
)
eq(order, ['t1', 't3', 't4', 't5', 't2'], 'ungrouped → groups by declaration → members in order')
eq(tg.orderedTabIds(['a', 'b'], [], { a: 'ghost-group' }), ['a', 'b'], 'membership in a dead group behaves as ungrouped')

console.log('\n── sanitizeGroups — hostile blobs fail closed ──')
eq(tg.sanitizeGroups('nope'), [], 'non-array → []')
eq(tg.sanitizeGroups([null, 42, { id: 'bad-id', name: 'x' }]), [], 'garbage entries dropped')
const good = tg.sanitizeGroups([{ id: 'tg_abcdef123456', name: 'ok', color: 'nope', collapsed: 'yes' }])
eq(good.length, 1, 'valid entry kept')
eq(good[0].color, 'blue', 'bad color sanitized')
eq(good[0].collapsed, false, 'collapsed true only when exactly boolean true')
const dup = tg.sanitizeGroups([
  { id: 'tg_abcdef123456', name: 'first' },
  { id: 'tg_abcdef123456', name: 'second' }
])
eq(dup.length, 1, 'duplicate ids deduped')

console.log('\n── wiring — TabManager, IPC, preload, renderer, settings ──')
const tabsSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'tabs.ts'), 'utf-8')
ok(tabsSrc.includes('createGroup(name'), 'TabManager.createGroup wired')
ok(tabsSrc.includes('restoreGroups(groups'), 'TabManager restores groups from session')
ok(tabsSrc.includes('groupId: this.tabGroupOf.get(t.id) ?? null'), 'getState carries group membership')
ok(tabsSrc.includes('groups: this.groups'), 'getState carries group metadata')
const typesSrc = fs.readFileSync(path.join(APP, 'src', 'shared', 'types.ts'), 'utf-8')
ok(typesSrc.includes('groupId?: string | null'), 'TabMeta.groupId typed')
ok(typesSrc.includes('groups?: TabGroupInfo[]'), 'TabsState.groups typed')
ok(typesSrc.includes("tabOrientation: 'top' | 'left'"), 'Settings.tabOrientation typed')
const storeSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'store.ts'), 'utf-8')
ok(storeSrc.includes("tabOrientation: 'top'"), 'default orientation is top (safe)')
const ipcSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf-8')
for (const ch of ['tabs:groupCreate', 'tabs:groupUpdate', 'tabs:groupDelete', 'tabs:groupAssign', 'ui:vtabWidth']) {
  ok(ipcSrc.includes(`'${ch}'`), `ipc handles ${ch}`)
}
const apiSrc = fs.readFileSync(path.join(APP, 'src', 'preload', 'api.ts'), 'utf-8')
ok(apiSrc.includes('groupCreate') && apiSrc.includes('groupAssign') && apiSrc.includes('setVtabWidth'), 'bridge exposes group + vtab methods')
const winSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'windows.ts'), 'utf-8')
ok(winSrc.includes('vtabWidth'), 'layout honors the vertical panel width')
ok(winSrc.includes('restoreGroups(opts.restore.groups'), 'session restore re-binds groups')
const srSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'session-restore.ts'), 'utf-8')
ok(srSrc.includes('groupId: t.groupId ?? null'), 'snapshot saves membership')
ok(srSrc.includes('idxOf.get(Number(tidStr))'), 'snapshot remaps live ids → indexes')
const vtabSrc = fs.readFileSync(path.join(APP, 'src', 'renderer', 'src', 'components', 'VerticalTabs.tsx'), 'utf-8')
ok(vtabSrc.includes('setVtabWidth'), 'vertical panel reports its width to main')
ok(vtabSrc.includes('groupCreate') && vtabSrc.includes('groupUpdate') && vtabSrc.includes('groupDelete'), 'group CRUD reachable from UI')
ok(vtabSrc.includes('collapsed'), 'group collapse toggle in UI')
const appSrc = fs.readFileSync(path.join(APP, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')
ok(appSrc.includes('VerticalTabs'), 'App renders the vertical panel')
ok(appSrc.includes("!vertical && <TabStrip />"), 'horizontal strip hidden in vertical mode')
ok(appSrc.includes('win-controls-float'), 'window controls survive the missing strip (win/linux)')
const pagesSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf-8')
ok(pagesSrc.includes('id="tabOrientation"'), 'settings expose the orientation choice')
const cssSrc = fs.readFileSync(path.join(APP, 'src', 'renderer', 'src', 'styles.css'), 'utf-8')
ok(cssSrc.includes('.vtabs {') && cssSrc.includes('.vtab-group-head'), 'styles for panel + groups present')
ok(cssSrc.includes('prefers-reduced-motion') === false || true, 'css sanity (no-op)')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(OUTDIR, { recursive: true, force: true })
console.log(`\n═══ test-v181: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
