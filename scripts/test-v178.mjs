/**
 * v1.7.0 build 7 — Phase 0 COMPLETE: secrets hygiene (#18), sandbox re-audit
 * (#17), release signing path (#11), version → 1.7.0.
 *
 * Exercises scripts/scan-secrets.mjs end-to-end (fixtures + self-exemption on
 * the real repo) and asserts the compensating controls of the chrome-UI
 * window audit, CI gates and docs.
 *
 * Run:  node scripts/test-v178.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(ROOT, '..')
const SCANNER = path.join(APP, 'scripts', 'scan-secrets.mjs')

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
function run(dir) {
  try {
    const out = execFileSync(process.execPath, [SCANNER, dir], { encoding: 'utf-8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }
  }
}

console.log('\n── scan-secrets.mjs — fixtures ──')
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-scan178-'))

fs.writeFileSync(path.join(fx, 'clean.ts'), `export const greeting = 'hello world'\nexport const n = 42\n`)
ok(run(fx).code === 0, 'clean fixture passes (exit 0)')

// ⚠️ All fake tokens below are BUILT AT RUNTIME via concatenation so that
// this test file itself never contains a credential-shaped literal —
// the repo must stay scan-clean (scan-secrets runs on it in CI).
const fakePat = 'github_pat_' + 'A'.repeat(26)
const fakeGhp = 'ghp_' + 'A'.repeat(36)
const fakeAws = 'AKIA' + 'A'.repeat(16)
const fakeSk = 'sk-proj-' + 'A'.repeat(20)
const fakeSlack = 'xoxb-' + '1'.repeat(12) + '-abcdef'
const fakeGoogle = 'AIza' + 'A'.repeat(32)
const fakePem = ['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' ')
const fakeGeneric = 'Abcd1234'.repeat(3)

fs.writeFileSync(path.join(fx, 'dirty.ts'), `const t = '${fakePat}'\n`)
const dirty = run(fx)
ok(dirty.code === 1, 'fine-grained PAT fixture fails (exit 1)')
ok(dirty.out.includes('GitHub PAT'), 'finding names the kind')

fs.writeFileSync(path.join(fx, 'dirty2.ts'), `const k = '${fakeGhp}'\n`)
ok(run(fx).code === 1, 'classic ghp_ token caught')

const kinds = [
  ['aws', `const a = '${fakeAws}'\n`],
  ['openai', `const a = '${fakeSk}'\n`],
  ['slack', `const a = '${fakeSlack}'\n`],
  ['google', `const a = '${fakeGoogle}'\n`],
  ['privkey', `const pem = '${fakePem}\\nMII'\n`],
  ['generic', `const config = { apiKey: '${fakeGeneric}' }\n`]
]
for (const [name, content] of kinds) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-k178-'))
  fs.writeFileSync(path.join(d, 'x.ts'), content)
  const r = run(d)
  ok(r.code === 1, `${name} pattern caught`)
  fs.rmSync(d, { recursive: true, force: true })
}

fs.mkdirSync(path.join(fx, 'node_modules', 'evil'), { recursive: true })
fs.writeFileSync(path.join(fx, 'node_modules', 'evil', 'x.js'), `const t = '${fakePat}'\n`)
fs.writeFileSync(path.join(fx, 'bin.png'), Buffer.from([0x00, 0x01, 0x02, 0x89, 0x50]))
ok(run(fx).code === 1, 'ignored dirs do not rescue a dirty repo (still fails on top-level)')
fs.rmSync(path.join(fx, 'dirty.ts'), { force: true })
fs.rmSync(path.join(fx, 'dirty2.ts'), { force: true })
ok(run(fx).code === 0, 'node_modules and binary files are skipped entirely')

console.log('\n── scan-secrets.mjs — self-exemption on the real repo ──')
ok(run(APP).code === 0, 'the Aether repo itself scans clean (patterns never match themselves)')

console.log('\n── chrome-UI sandbox re-audit (#17) — compensating controls ──')
const winSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'windows.ts'), 'utf-8')
ok(winSrc.includes('contextIsolation: true'), 'chrome-UI keeps contextIsolation ON')
ok(winSrc.includes('nodeIntegration: false'), 'chrome-UI keeps nodeIntegration OFF')
ok(winSrc.includes('webSecurity: true'), 'webSecurity explicitly ON')
ok(winSrc.includes('allowRunningInsecureContent: false'), 'insecure content blocked')
ok(winSrc.includes('experimentalFeatures: false'), 'no experimental features')
ok(winSrc.includes('sandbox: false'), 'sandbox:false is a documented decision, not an accident')
ok(winSrc.includes('CHROME_SHELL_LOCK'), 'navlock chrome-shell lockdown still wired')
ok(winSrc.includes("will-attach-webview"), 'webview attach still refused')
const navSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'navlock.ts'), 'utf-8')
ok(/CHROME_SHELL_LOCK\s*=\s*true/.test(navSrc), 'chrome shell lock is enabled')
const viteSrc = fs.readFileSync(path.join(APP, 'electron.vite.config.ts'), 'utf-8')
ok(viteSrc.includes('injectBrowserAction'), 'ui preload glue limited to extension browser-action injection')
ok(viteSrc.includes("require('electron-chrome-extensions"), 'ui preload footer requires only the extensions glue')

console.log('\n── CI gates + signing path (#11/#16/#18) ──')
const ciSrc = fs.readFileSync(path.join(APP, '.github/workflows/build.yml'), 'utf-8')
ok(ciSrc.includes('node scripts/scan-secrets.mjs .'), 'CI runs the secrets scan on every build')
ok(ciSrc.includes('npm audit --audit-level=high'), 'CI audit gate still present')
ok(ciSrc.includes('WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}'), 'release job wires Windows signing env')
ok(ciSrc.includes('MAC_CSC_LINK: ${{ secrets.MAC_CSC_LINK }}'), 'release job wires macOS signing env')
ok(ciSrc.includes('APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}'), 'release job wires notarization env')
ok(ciSrc.includes('branches: [main]'), 'push filter is a proper list')

const hooks = path.join(APP, 'scripts', 'hooks', 'pre-commit')
ok(fs.existsSync(hooks), 'pre-commit hook exists in-repo')
ok(process.platform === 'win32' || (fs.statSync(hooks).mode & 0o111) !== 0, 'pre-commit hook is executable')
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf-8'))
ok(pkg.scripts['scan:secrets'] !== undefined, 'npm run scan:secrets available')
ok(pkg.scripts['hooks:install'] !== undefined, 'npm run hooks:install available')
ok(pkg.version >= '1.7.0', 'version is at least 1.7.0 (Phase 0 milestone; Phase 2 moved on)')

const hyg = fs.readFileSync(path.join(APP, 'docs', 'SECURITY-HYGIENE.md'), 'utf-8')
ok(hyg.includes('Rotation runbook') || hyg.includes('rotation runbook'), 'SECURITY-HYGIENE has the rotation runbook')
ok(hyg.includes('scan-secrets.mjs'), 'SECURITY-HYGIENE references the gate')
const sig = fs.readFileSync(path.join(APP, 'docs', 'RELEASE-SIGNING.md'), 'utf-8')
ok(sig.includes('Authenticode') && sig.includes('notarization'), 'RELEASE-SIGNING covers win+mac')
ok(sig.includes('embeddedAsarIntegrity'), 'RELEASE-SIGNING ties into the ASAR integrity fuses')

console.log(`\n═══ test-v178: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
