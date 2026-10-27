#!/usr/bin/env node
/**
 * v2.9.0 build 23 — "The model ain't replying" wave:
 *   AI reliability: page-context eval timeouts (extract.ts), brain stream
 *   watchdogs (first-token + idle, hard-aborts wedged models), agent per-call
 *   ceiling, sidebar error surfacing + patience hint
 *   Browser profiles: side-by-side "Open in new window" (profiles:launch),
 *   inline profile creation in the toolbar popover, profile identity tint
 *
 * Coverage:
 *  - main/extract.ts withTimeout (resolve / stall-reject) — FUNCTIONAL bundle
 *  - main/brain.ts watchBrainStream — FUNCTIONAL against a live mock Ollama:
 *      happy path streams through, first-token stall aborts+errors, idle stall
 *      aborts+errors, user-abort passes through
 *  - main/profiles.ts canLaunchProfile + switchProfileArgs — FUNCTIONAL bundle
 *  - static wiring gates across main/preload/renderer/pages/package
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireCjs = createRequire(import.meta.url)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outdir = path.join(ROOT, '.test-v290-tmp')
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

/** Bundle a main-process module to CJS under `outdir`, stubbing electron. */
async function bundleMain(rel, outfile, extraStub = '') {
  await build({
    entryPoints: [path.join(ROOT, rel)],
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

/* ============================ 1. extract.ts withTimeout ============================ */
section('extract.ts: page-eval timeout race')
{
  const mod = await bundleMain('src/main/extract.ts', 'extract-test.cjs')
  const { withTimeout } = mod
  ok(typeof withTimeout === 'function', 'withTimeout exported')

  // resolves with the underlying value and clears the timer
  const fast = await withTimeout(Promise.resolve('v29'), 1000, 'fast op')
  ok(fast === 'v29', 'resolved value passes through')

  // a never-settling promise must reject (this is the old infinite-hang bug)
  const never = new Promise(() => {})
  const t0 = Date.now()
  let stalled = ''
  try {
    await withTimeout(never, 120, 'page DOM capture')
  } catch (err) {
    stalled = err instanceof Error ? err.message : String(err)
  }
  ok(/page DOM capture timed out after 120ms/.test(stalled), `stalled eval rejected with label (${stalled})`)
  ok(Date.now() - t0 < 3000, 'rejection arrived promptly, not late')

  // an underlying rejection still surfaces untouched
  let boom = ''
  try {
    await withTimeout(Promise.reject(new Error('render frame disposed')), 1000, 'boom')
  } catch (err) {
    boom = err instanceof Error ? err.message : String(err)
  }
  ok(boom === 'render frame disposed', 'underlying error passes through')

  const src = read('src/main/extract.ts')
  ok(src.includes('export function withTimeout'), 'withTimeout defined in extract.ts')
  ok(src.includes('EVAL_TIMEOUT_MS'), 'eval timeout constant present')
  ok(/withTimeout\(\s*wc\.executeJavaScript\('document\.documentElement\.outerHTML'/s.test(src), 'DOM capture eval is race-limited (the old infinite hang)')
  ok(src.includes('.catch(() => \'\')'), 'inner-text eval keeps its soft fallback')
}

/* ============================ 2. brain.ts watchdogs ============================ */
section('brain.ts: watchBrainStream against a live mock Ollama')
{
  /** Mock Ollama — the test flips `mockMode` between scenarios. */
  let mockMode = 'ok'
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const mode = mockMode
      if (mode === 'hang-forever') return // never respond — first-token stall
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      if (mode === 'stream-then-hang') {
        res.write(JSON.stringify({ message: { content: 'first ' } }) + '\n')
        res.write(JSON.stringify({ message: { content: 'token ' } }) + '\n')
        // then go silent mid-stream — idle watchdog territory
        return
      }
      res.write(JSON.stringify({ message: { content: 'hello ' } }) + '\n')
      res.write(JSON.stringify({ message: { content: 'world' } }) + '\n')
      res.end()
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  process.env.AETHER_OLLAMA_URL = `http://127.0.0.1:${port}`

  const brain = await bundleMain('src/main/brain.ts', 'brain-test.cjs')
  const { watchBrainStream, FIRST_TOKEN_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_MS } = brain
  const choice = { provider: 'local', model: 'mock' }
  const msgs = [{ role: 'user', content: 'hi' }]

  ok(FIRST_TOKEN_TIMEOUT_MS === 180_000, 'first-token watchdog default = 180s (cold loads stay safe)')
  ok(STREAM_IDLE_TIMEOUT_MS === 120_000, 'idle watchdog default = 120s')

  // happy path — both deltas stream through and the stream completes
  {
    mockMode = 'ok'
    const ctrl = new AbortController()
    const got = []
    for await (const d of watchBrainStream(choice, msgs, ctrl, { firstTokenMs: 2000, idleMs: 2000 })) got.push(d)
    ok(got.join('') === 'hello world', `happy path streams through (${got.join('')})`)
    ok(!ctrl.signal.aborted, 'happy path never aborts')
  }

  // first-token stall — the fetch hangs, watchdog aborts + throws fast
  {
    mockMode = 'hang-forever'
    const ctrl = new AbortController()
    const t0 = Date.now()
    let msg = ''
    try {
      for await (const d of watchBrainStream(choice, msgs, ctrl, { firstTokenMs: 250, idleMs: 60_000 })) void d
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err)
    }
    ok(/produced no output within 0s|no output within/.test(msg), `first-token stall surfaces a clear error (${msg.slice(0, 60)})`)
    ok(ctrl.signal.aborted, 'watchdog hard-aborts the wedged fetch')
    ok(Date.now() - t0 < 3000, 'first-token watchdog fires promptly')
  }

  // idle stall — first tokens arrive, then the stream goes silent
  {
    mockMode = 'stream-then-hang'
    const ctrl = new AbortController()
    let msg = ''
    const got = []
    try {
      for await (const d of watchBrainStream(choice, msgs, ctrl, { firstTokenMs: 2000, idleMs: 250 })) got.push(d)
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err)
    }
    ok(got.join('') === 'first token ', `pre-stall deltas preserved (${got.join('')})`)
    ok(/model stalled/.test(msg), `idle stall surfaces a clear error (${msg.slice(0, 60)})`)
    ok(ctrl.signal.aborted, 'idle watchdog hard-aborts the wedged fetch')
  }

  // user abort passes through untouched (no watchdog text)
  {
    mockMode = 'ok'
    const ctrl = new AbortController()
    const src = brain.streamBrain
    ok(typeof src === 'function', 'streamBrain still exported for other callers')
    // simulate: abort before consuming — the next() must reject with AbortError-ish
    const it = watchBrainStream(choice, msgs, ctrl, { firstTokenMs: 60_000, idleMs: 60_000 })
    ctrl.abort()
    let userAbort = false
    try {
      await it.next()
    } catch {
      userAbort = true
    }
    ok(userAbort, 'pre-aborted stream errors immediately (user stop still works)')
  }

  server.close()
}

/* ============================ 3. profiles: side-by-side launch ============================ */
section('profiles.ts: launch policy')
{
  const profiles = await bundleMain('src/main/profiles.ts', 'profiles-test.cjs')
  profiles.initProfiles(outdir, 'default')
  const made = profiles.createProfile('Work', '#4cc38a')
  ok(made.ok === true, 'fixture profile created')
  const list = profiles.listProfiles()
  const other = list.find((p) => p.id !== 'default')
  ok(Boolean(other), 'non-default profile exists in registry')

  ok(profiles.canLaunchProfile('default', 'default').ok === false, 'launching the running profile is refused')
  ok(/already running/.test(profiles.canLaunchProfile('default', 'default').error || ''), 'refusal explains itself')
  ok(profiles.canLaunchProfile('nope', 'default').ok === false, 'unknown id refused')
  ok(profiles.canLaunchProfile('../etc', 'default').ok === false, 'path-ish id refused (validateProfileId)')
  ok(profiles.canLaunchProfile(null, 'default').ok === false, 'null id refused')
  ok(profiles.canLaunchProfile(other.id, 'default').ok === true, 'a valid other profile may open side-by-side')

  const args = profiles.switchProfileArgs(other.id)
  ok(args.includes(`--aether-profile=${other.id}`), 'launch argv carries --aether-profile=<id>')
  ok(!args.some((a) => /^--aether-app(=|$)/.test(a)), 'launch argv strips stale --aether-app')

  // launchProfile with a REFUSED id must return the typed error, never spawn
  const refused = profiles.launchProfile('default')
  ok(refused.ok === false && /already running/.test(refused.error || ''), 'launchProfile refuses the active profile without spawning')

  const src = read('src/main/profiles.ts')
  ok(src.includes("spawn(process.execPath, switchProfileArgs(pid)"), 'launch spawns a detached second instance')
  ok(src.includes("detached: true"), 'spawn is detached (does not tie to this process)')
  ok(src.includes("child.unref()"), 'child is unreferenced')
}

/* ============================ 4. wiring: ipc + preload ============================ */
section('wiring: IPC + preload bridge')
{
  const ipc = read('src/main/ipc.ts')
  ok(ipc.includes("ipcMain.handle('profiles:launch'"), 'profiles:launch handler registered')
  ok(/guard\(e, 'profiles:launch'\)\s*\n\s*return launchProfile/.test(ipc), 'profiles:launch is guarded and routes to launchProfile')
  ok(ipc.includes('launchProfile') && ipc.includes("from './profiles'"), 'launchProfile imported from profiles.ts')
  ok(ipc.includes('watchBrainStream'), 'ipc uses the watchdogged stream')
  ok((ipc.match(/watchBrainStream\(/g) || []).length >= 2, 'both ai:chat and internal:ask consume the watchdogged stream')
  ok(!ipc.includes('streamBrain('), 'no un-watchdogged brain streams remain in ipc.ts')

  const api = read('src/preload/api.ts')
  ok(api.includes("launch: (id: string) => ipcRenderer.invoke('profiles:launch', id)"), 'bridge exposes profiles.launch')
  ok(api.includes("onProfile: subscribe('win:profile')"), 'bridge exposes state.onProfile')

  const win = read('src/main/windows.ts')
  ok(win.includes("send('win:profile'"), 'main sends the window profile identity on load')
  ok(win.includes('activeProfile()'), 'identity comes from the registry')
}

/* ============================ 5. wiring: renderer ============================ */
section('wiring: renderer surfaces')
{
  const toolbar = read('src/renderer/src/components/Toolbar.tsx')
  ok(toolbar.includes('PROFILE_COLORS'), 'popover color swatches come from the shared palette')
  ok(toolbar.includes('Open in new window'), 'per-profile side-by-side launch affordance')
  ok(toolbar.includes('window.aether.profiles.launch'), 'launch affordance is wired to the bridge')
  ok(toolbar.includes('New profile…'), 'inline create entry point')
  ok(toolbar.includes('createProfileInline'), 'inline create handler present')
  ok(toolbar.includes('Manage profiles'), 'manage entry point (settings deep-link)')

  const app = read('src/renderer/src/App.tsx')
  ok(app.includes('profile-tint'), 'chrome renders the profile identity tint')
  ok(app.includes('onProfile'), 'chrome subscribes to the profile identity event')

  const store = read('src/renderer/src/state/store.ts')
  ok(store.includes('profile: WindowProfile | null'), 'global store carries the window profile')

  const css = read('src/renderer/src/styles.css')
  ok(css.includes('.profile-tint'), 'profile tint styled')
  ok(css.includes('.profile-create'), 'inline create form styled')
  ok(css.includes('.profile-swatch'), 'color swatches styled')
  ok(css.includes('.profile-launch'), 'launch affordance styled')
  ok(css.includes('.wait-hint'), 'AI patience hint styled')

  const sidebar = read('src/renderer/src/components/Sidebar.tsx')
  ok(sidebar.includes('wait-hint'), 'sidebar shows the waiting-for-model hint')
  ok(sidebar.includes("aborted ? 'Stopped.' : '⚠️ ' + msg"), 'errors fill the answer bubble (no duplicate bubble)')
  ok(/if \(!aborted\) void refresh\(\)/.test(sidebar), 'failed sends re-check the backend (self-heal)')
  ok(/setWaitingHint\(true\), 6_000|setTimeout\(\(\) => setWaitingHint\(true\), 6_000\)/.test(sidebar), 'patience hint arms after 6s of silence')

  const executor = read('src/main/agent/executor.ts')
  ok(executor.includes('AGENT_CALL_TIMEOUT_MS'), 'agent model calls carry a hard ceiling')
  ok(/setTimeout\(\(\) => inner\.abort\(\), AGENT_CALL_TIMEOUT_MS\)/.test(executor), 'ceiling aborts the inner controller')

  const pages = read('src/main/pages.ts')
  ok(pages.includes("'Open in new window'") && pages.includes('profiles.launch(p.id)'), 'settings profile rows can open side-by-side')
}

/* ============================ 6. package ============================ */
section('wiring: package')
{
  const pkg = JSON.parse(read('package.json'))
  const [vMaj, vMin] = pkg.version.split('.').map(Number)
  ok(vMaj > 2 || (vMaj === 2 && vMin >= 9), 'package version is at least 2.9.0 (numeric-aware: later builds move on)')
  ok(pkg.scripts.test.includes('test-v290.mjs'), 'test chain includes test-v290')
  ok(pkg.scripts.test.includes('test-v280.mjs'), 'prior suite still chained')
}

console.log(`\n════════════════════════════════════════`)
console.log(`  test-v290: ${pass} passed, ${fail} failed`)
console.log(`════════════════════════════════════════`)
try {
  rmSync(outdir, { recursive: true, force: true })
} catch {
  /* windows file locks — best effort */
}
process.exit(fail === 0 ? 0 : 1)
