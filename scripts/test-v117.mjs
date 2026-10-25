/**
 * v1.1.7 unit tests — profile cache-lock recovery ("Access is denied (0x5)").
 *
 * Regression: a locked profile cache (second instance / AV / OneDrive) left
 * Chromium with "Unable to move the cache: Access is denied. (0x5)" +
 * "Gpu Cache Creation failed: -2" and pages refused to load — with zero
 * explanation. The app must (a) refuse a second instance unconditionally and
 * (b) relocate to a deterministic `-recovered` profile when the cache is
 * locked, telling the user exactly how to reclaim the old one.
 *
 * Run:  node scripts/test-v117.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

/* ---------- build a runnable bundle (profile-recovery.ts is pure — no electron) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test117-'))
fs.mkdirSync(path.join(tmp, 'src', 'main'), { recursive: true })
fs.copyFileSync(path.join(APP, 'src', 'main', 'profile-recovery.ts'), path.join(tmp, 'src', 'main', 'profile-recovery.ts'))
const entry = path.join(tmp, 'src', 'testable.ts')
fs.writeFileSync(
  entry,
  `export { recoveryCandidates, decideProfileDir, recoveryBanner, MAX_RECOVERY_CANDIDATES } from './main/profile-recovery'`
)

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(tmp, 'bundle.mjs'),
  logLevel: 'silent'
})

const B = await import(pathToFileURL(path.join(tmp, 'bundle.mjs')).href)
const { recoveryCandidates, decideProfileDir, recoveryBanner, MAX_RECOVERY_CANDIDATES } = B

const REAL = '/home/u/.config/aether-browser'
const WIN = 'C:\\Users\\u\\AppData\\Roaming\\aether-browser'

/* ---------- 1. recoveryCandidates ---------- */
{
  const c = recoveryCandidates(REAL)
  ok(c.length === MAX_RECOVERY_CANDIDATES, `exactly ${MAX_RECOVERY_CANDIDATES} candidates are tried`)
  ok(c[0] === REAL + '-recovered', 'first candidate is <profile>-recovered')
  ok(c[1] === REAL + '-recovered-2' && c[2] === REAL + '-recovered-3', 'later candidates are numbered deterministically')
  const w = recoveryCandidates(WIN)
  ok(w[0] === WIN + '-recovered', 'windows-style paths keep their base name (no path.join mangling)')
}

/* ---------- 2. decideProfileDir — healthy profile ---------- */
{
  const probed = []
  const probe = (d) => (probed.push(d), true)
  const d = decideProfileDir(REAL, probe)
  ok(d.dir === REAL && d.original === REAL, 'writable profile boots in place')
  ok(d.relocated === false && d.reason === 'ok', 'no relocation when the cache dir is writable')
  ok(probed.length === 1 && probed[0] === path.join(REAL, 'Cache'), 'probe targets <userData>/Cache exactly')
}

/* ---------- 3. decideProfileDir — locked, first recovery works ---------- */
{
  const probed = []
  const probe = (d) => (probed.push(d), !d.endsWith('-recovered\\Cache') && d !== path.join(REAL, 'Cache'))
  const d = decideProfileDir(REAL, probe)
  ok(d.relocated === true && d.reason === 'locked', 'locked cache triggers relocation')
  ok(d.dir === REAL + '-recovered', 'relocates to the first free candidate')
  ok(d.original === REAL, 'the original dir is preserved in the decision (for the banner)')
  ok(probed.includes(path.join(REAL, 'Cache')), 'the ORIGINAL cache dir was probed first')
  ok(probed.includes(path.join(REAL + '-recovered', 'Cache')), 'the candidate cache dir was probed before moving')
}

/* ---------- 4. decideProfileDir — cascade through candidates ---------- */
{
  const locked = new Set([path.join(REAL, 'Cache'), path.join(REAL + '-recovered', 'Cache')])
  const d = decideProfileDir(REAL, (dir) => !locked.has(dir))
  ok(d.dir === REAL + '-recovered-2' && d.relocated, 'second candidate used when the first is also locked')

  locked.add(path.join(REAL + '-recovered-2', 'Cache'))
  const d3 = decideProfileDir(REAL, (dir) => !locked.has(dir))
  ok(d3.dir === REAL + '-recovered-3' && d3.relocated, 'third candidate used when the first two are locked')
}

/* ---------- 5. decideProfileDir — everything locked ---------- */
{
  const d = decideProfileDir(REAL, () => false)
  ok(d.dir === REAL && d.relocated === false, 'all candidates locked -> stays on the original profile')
  ok(d.reason === 'fallback-locked', 'reason reports fallback-locked (Chromium degrades to memory cache)')
}

/* ---------- 6. forceLocked test hook (CI recovery path) ---------- */
{
  const probed = []
  const d = decideProfileDir(REAL, (dir) => (probed.push(dir), true), true)
  ok(d.relocated === true && d.dir === REAL + '-recovered', 'forceLocked simulates the incident and relocates')
  ok(!probed.includes(path.join(REAL, 'Cache')), 'forceLocked skips probing the (supposedly dead) original cache')
}

/* ---------- 7. recoveryBanner ---------- */
{
  const lines = recoveryBanner(REAL, REAL + '-recovered')
  const text = lines.join('\n')
  ok(lines.length >= 8, 'banner is a real multi-line explanation, not a one-liner')
  ok(text.includes(REAL), 'banner names the OLD profile dir (kept, not deleted)')
  ok(text.includes(REAL + '-recovered'), 'banner names the NEW profile dir')
  ok(text.includes('electron.exe') && text.includes('Task Manager'), 'banner gives the concrete Windows kill steps')
  ok(text.includes('Unable to move the cache'), 'banner ties back to the exact Chromium error the user saw')
  ok(!/delete.*recovered/i.test(text.replace('Delete (or rename) the old profile folder above', '')), 'banner never tells the user to delete the RECOVERED profile')
}

console.log(`\nv1.1.7 profile-recovery: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
