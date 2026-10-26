#!/usr/bin/env node
/**
 * v2.4.0 build 18 — multi-profiles + omnibox inline autocomplete +
 * paste-and-go + tab hover previews.
 *
 * Pure-policy coverage (bundled from src/shared via esbuild) + static wiring
 * gates that keep the risky plumbing honest (profile arg parsed BEFORE the
 * single-instance lock, switch relaunch flushes the session, XSS-safe
 * settings DOM, ghost alignment, preview throttling).
 */
import { build } from 'esbuild'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// bundle the shared pure modules INSIDE the app tree so imports resolve
const outdir = path.join(ROOT, '.test-v240-tmp')
const { outputFiles } = await build({
  entryPoints: [
    path.join(ROOT, 'src/shared/profiles.ts'),
    path.join(ROOT, 'src/shared/omnibox.ts')
  ],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outdir,
  write: false,
  logLevel: 'silent'
})

const modules = {}
for (const f of outputFiles) {
  const name = path.basename(f.path, '.js')
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', f.text)(mod, mod.exports)
  modules[name] = mod.exports
}

const profiles = modules['profiles']
const omnibox = modules['omnibox']

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) {
    pass++
  } else {
    fail++
    console.error('  FAIL:', label)
  }
}
function section(name) {
  console.log(`\n=== ${name} ===`)
}

// ── parseProfileArg ──────────────────────────────────────────────────────────
section('parseProfileArg')
ok(profiles.parseProfileArg([]) === null, 'no args → null')
ok(profiles.parseProfileArg(['electron', '.', '--aether-profile=work']) === 'work', '= form parsed')
ok(profiles.parseProfileArg(['electron', '--aether-profile', 'work']) === 'work', 'space form parsed')
ok(profiles.parseProfileArg(['--aether-profile=default']) === null, 'explicit default → null (no setPath)')
ok(profiles.parseProfileArg(['--aether-profile=..']) === null, 'traversal id rejected')
ok(profiles.parseProfileArg(['--aether-profile=Work']) === null, 'uppercase id rejected')
ok(profiles.parseProfileArg(['--aether-profile=']) === null, 'empty id rejected')
ok(profiles.parseProfileArg(['--aether-profile=p1', '--aether-profile=p2']) === 'p2', 'last occurrence wins')
ok(profiles.parseProfileArg(undefined) === null, 'undefined argv → null')

// ── sanitizeProfileName / color / ids ───────────────────────────────────────
section('sanitizeProfileName + color + id')
ok(profiles.sanitizeProfileName('  Work  ') === 'Work', 'trims')
ok(profiles.sanitizeProfileName('a\u0000b\u001fc') === 'abc', 'control chars stripped')
ok(profiles.sanitizeProfileName('x'.repeat(80)) === 'x'.repeat(40), 'capped at 40')
ok(profiles.sanitizeProfileName('   ') === 'Profile', 'empty → fallback')
ok(profiles.sanitizeProfileName('', 'Team') === 'Team', 'custom fallback')
ok(profiles.normalizeProfileColor('#4cc38a') === '#4cc38a', 'palette color kept')
ok(profiles.normalizeProfileColor('#ff00ff') === profiles.PROFILE_COLORS[0], 'unknown color → palette head')
ok(profiles.validateProfileId('pabc123') === true, 'valid id')
ok(profiles.validateProfileId('default') === true, 'default is a valid id')
ok(profiles.validateProfileId('has space') === false, 'space rejected')
ok(profiles.validateProfileId(42) === false, 'number rejected')
const id1 = profiles.newProfileId(1700000000000, () => 0.5)
const id2 = profiles.newProfileId(1700000000000, () => 0.9)
ok(id1 !== id2, 'ids unique across rng')
ok(/^p[a-z0-9]+$/.test(id1), 'id shape')

// ── normalizeRegistry ────────────────────────────────────────────────────────
section('normalizeRegistry')
const reg0 = profiles.normalizeRegistry(null)
ok(reg0.profiles.length === 1 && reg0.profiles[0].id === 'default', 'empty disk → default seeded')
ok(reg0.profiles[0].name === 'Personal', 'default named Personal')
const reg1 = profiles.normalizeRegistry({
  profiles: [
    { id: 'pz', name: 'Zeta', color: '#4cc38a', lastUsedAt: 300 },
    { id: 'default', name: 'dup should vanish', color: 'x' },
    { id: 'bad id', name: 'nope' },
    null,
    { id: 'pa', name: 'Alpha', lastUsedAt: 900 }
  ]
})
ok(reg1.profiles[0].id === 'default', 'default always first')
ok(reg1.profiles[0].name === 'Personal', 'duplicate default dropped, canonical kept')
ok(reg1.profiles[1].id === 'pa' && reg1.profiles[2].id === 'pz', 'sorted by lastUsedAt desc')
ok(reg1.profiles.length === 3, 'garbage dropped')
const many = { profiles: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })) }
ok(profiles.normalizeRegistry(many).profiles.length === profiles.MAX_PROFILES, 'capped at MAX_PROFILES')
ok(
  profiles.normalizeRegistry({ profiles: [{ id: 'pa' }] }).profiles.some((p) => p.id === 'pa' && typeof p.createdAt === 'number'),
  'missing ts fields coerced'
)

// ── canDeleteProfile + touchProfile ─────────────────────────────────────────
section('delete policy + touch')
const demo = profiles.normalizeRegistry({ profiles: [{ id: 'pwork', name: 'Work' }] })
ok(profiles.canDeleteProfile(demo.profiles, 'default', 'default').ok === false, 'default undeletable')
ok(profiles.canDeleteProfile(demo.profiles, 'pwork', 'pwork').ok === false, 'active undeletable')
ok(profiles.canDeleteProfile(demo.profiles, 'pwork', 'default').ok === true, 'inactive deletable')
ok(profiles.canDeleteProfile(demo.profiles, 'pghost', 'default').ok === false, 'unknown refused')
const touched = profiles.touchProfile(demo, 'pwork', 1234)
ok(touched.profiles.find((p) => p.id === 'pwork').lastUsedAt === 1234, 'touch sets lastUsedAt')
ok(demo.profiles.find((p) => p.id === 'pwork').lastUsedAt === 0, 'touch does not mutate input')

// ── profileInitial ───────────────────────────────────────────────────────────
section('profileInitial')
ok(profiles.profileInitial('work') === 'W', 'first letter uppercased')
ok(profiles.profileInitial('') === '?', 'empty → ?')
ok(profiles.profileInitial('Personal') === 'P', 'name passthrough')

// ── inlineComplete ───────────────────────────────────────────────────────────
section('inlineComplete (ghost type-ahead)')
ok(omnibox.inlineComplete('yout', { value: 'youtube.com' }) === 'ube.com', 'basic completion suffix')
ok(omnibox.inlineComplete('YOUT', { value: 'youtube.com' }) === 'ube.com', 'case-insensitive start')
ok(omnibox.inlineComplete('youtube.com', { value: 'youtube.com' }) === null, 'equal → null (nothing to add)')
ok(omnibox.inlineComplete('youtube.com/x', { value: 'youtube.com' }) === null, 'input longer than value → null')
ok(omnibox.inlineComplete('yout ', { value: 'youtube.com' }) === null, 'trailing space → never complete')
ok(omnibox.inlineComplete('yout', null) === null, 'no top row → null')
ok(omnibox.inlineComplete('yout', { value: 'cats' }) === null, 'non-prefix → null')
ok(omnibox.inlineComplete('', { value: 'x' }) === null, 'empty input → null')
ok(omnibox.inlineComplete('git', { value: 'github.com/user/repo' }) === 'hub.com/user/repo', 'long completion')

// ── pasteGoTarget ────────────────────────────────────────────────────────────
section('pasteGoTarget')
ok(omnibox.pasteGoTarget('  https://example.com/a?b=1 ') === 'https://example.com/a?b=1', 'trims + keeps URL')
ok(omnibox.pasteGoTarget('example.com') === 'example.com', 'domain-like accepted')
ok(omnibox.pasteGoTarget('example.com/path') === 'example.com/path', 'domain + path accepted')
ok(omnibox.pasteGoTarget('cats and dogs') === null, 'phrase → null')
ok(omnibox.pasteGoTarget('javascript:alert(1)') === null, 'javascript: rejected')
ok(omnibox.pasteGoTarget('data:text/html,x') === null, 'data: rejected')
ok(omnibox.pasteGoTarget('') === null, 'empty → null')
ok(omnibox.pasteGoTarget('file:///etc/passwd') === null, 'file:// rejected (navlock would too)')

// ── static wiring gates ──────────────────────────────────────────────────────
section('wiring: preboot / windows / ipc')
const preboot = readFileSync(path.join(ROOT, 'src/main/preboot.ts'), 'utf-8')
ok(preboot.includes("from '../shared/profiles'"), 'preboot parses the profile arg (shared policy)')
ok(preboot.includes('parseProfileArg(process.argv)'), 'preboot scans argv')
ok(preboot.indexOf('parseProfileArg') < preboot.indexOf('requestSingleInstanceLock'), 'profile setPath happens BEFORE the single-instance lock')
ok(preboot.includes("path.join(originalUserDataPath, 'profiles', bootProfileId)"), 'profile userData = <base>/profiles/<id>')
ok(preboot.includes('initProfiles(originalUserDataPath, bootProfileId)'), 'registry pinned to ORIGINAL userData')

const wins = readFileSync(path.join(ROOT, 'src/main/windows.ts'), 'utf-8')
ok(wins.includes('switchToProfile'), 'windows.switchToProfile exists (flush + relaunch)')
ok(wins.includes('flushSessionNow(allEntries(), true)'), 'switch flushes the session with a clean marker')
ok(wins.includes('markQuitting()'), 'switch marks a clean quit (no crash warning next boot)')
ok(wins.includes('switchProfileArgs(pid)'), 'switch relaunches with --aether-profile=<id>')
ok(wins.includes('activeProfileName()'), 'window title carries the profile name')

const ipc = readFileSync(path.join(ROOT, 'src/main/ipc.ts'), 'utf-8')
for (const ch of ['profiles:list', 'profiles:create', 'profiles:rename', 'profiles:delete', 'profiles:switch', 'tabs:preview', 'ui:clipboard-read']) {
  ok(ipc.includes(`'${ch}'`), `ipc channel ${ch} registered`)
}
ok(ipc.includes("guard(e, 'profiles:switch')") && ipc.includes("guard(e, 'tabs:preview')"), 'new channels are sender-guarded')

const menu = readFileSync(path.join(ROOT, 'src/main/menu.ts'), 'utf-8')
ok(menu.includes("label: 'Profiles'"), 'app menu has a Profiles submenu')
ok(menu.includes('listProfiles()') && menu.includes('activeProfileId()'), 'menu built from the live registry')
ok(menu.includes('switchToProfile'), 'menu items switch profiles')

const preload = readFileSync(path.join(ROOT, 'src/preload/api.ts'), 'utf-8')
ok(preload.includes("'profiles:list'") && preload.includes("'profiles:switch'"), 'preload exposes profiles group')
ok(preload.includes("'tabs:preview'"), 'preload exposes tabs.preview')
ok(preload.includes("'ui:clipboard-read'"), 'preload exposes clipboard.readText (paste-and-go)')

section('wiring: renderer')
const toolbar = readFileSync(path.join(ROOT, 'src/renderer/src/components/Toolbar.tsx'), 'utf-8')
ok(toolbar.includes('inlineComplete('), 'Toolbar renders ghost via inlineComplete')
ok(toolbar.includes("key === 'Tab' && ghost"), 'Tab accepts the completion')
ok(toolbar.includes('pasteGoTarget('), 'paste-and-go uses the shared sanitizer')
ok(toolbar.includes('window.aether.clipboard.readText()'), 'middle-click reads the clipboard through the bridge')
ok(toolbar.includes('profile-btn') && toolbar.includes('window.aether.profiles.switch'), 'profile avatar + switch wired')
ok(toolbar.includes('omni-ghost'), 'ghost overlay rendered')

const strip = readFileSync(path.join(ROOT, 'src/renderer/src/components/TabStrip.tsx'), 'utf-8')
ok(strip.includes('window.aether.tabs.preview('), 'TabStrip asks for a preview thumbnail')
ok(strip.includes('600'), 'preview waits 600ms hover')
ok(strip.includes('t.id === activeId || t.discarded || t.hibernated'), 'active/unloaded tabs skip previews')
ok(strip.includes('previewSeq.current'), 'stale preview responses discarded')
ok(strip.includes('tab-preview'), 'preview card rendered')

section('wiring: settings page (XSS-safe)')
const pages = readFileSync(path.join(ROOT, 'src/main/pages.ts'), 'utf-8')
ok(pages.includes('id="profList"') && pages.includes('id="profAdd"'), 'Profiles card present in Settings')
ok(pages.includes('renderProfiles()'), 'Profiles card wired')
ok(!/profList[\s\S]{0,400}innerHTML\s*=/m.test(pages.split('id="profList"')[1]?.slice(0, 2500) || ''), 'no innerHTML sinks in the profile list (textContent-only)')

section('wiring: CSS')
const css = readFileSync(path.join(ROOT, 'src/renderer/src/styles.css'), 'utf-8')
ok(css.includes('.omni-ghost-dim'), 'ghost dim style present')
ok(css.includes('.profile-menu'), 'profile menu style present')
ok(css.includes('.tab-preview'), 'tab preview card style present')
ok(css.includes('font-size: 13px'), 'ghost font-size matches the omnibox input (13px)')

console.log(`\n════════════════════════════════════`)
console.log(`  v2.4.0: ${pass} passed, ${fail} failed`)
console.log(`════════════════════════════════════`)
process.exit(fail ? 1 : 0)
