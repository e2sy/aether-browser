/**
 * v1.7.0 build 3 — Fuse hardening + security meta tests.
 *
 * Proves: the fuse spec never leaves RunAsNode on, the hook file parses,
 * the builder config wires it, SECURITY.md carries the disclosure contract,
 * Dependabot watches both ecosystems, and CI gates on npm audit.
 *
 * Run:  node scripts/test-v174.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(ROOT, '..')
const require = createRequire(import.meta.url)

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

/* ================= 1. fuse spec invariants ================= */
console.log('\n[1] fuse spec — the escape hatches stay welded shut')
{
  const { FUSE_SPEC, electronBinaryPath } = require(path.join(APP, 'scripts', 'apply-fuses.js'))
  ok(FUSE_SPEC.runAsNode === false, 'RunAsNode OFF (no env-var Node REPL)')
  ok(FUSE_SPEC.enableNodeOptionsEnvironmentVariable === false, 'NODE_OPTIONS OFF')
  ok(FUSE_SPEC.enableNodeCliInspectArguments === false, '--inspect OFF')
  ok(FUSE_SPEC.grantFileProtocolExtraPrivileges === false, 'file:// extra privileges OFF')
  ok(FUSE_SPEC.enableCookieEncryption === true, 'cookie encryption ON')
  ok(FUSE_SPEC.onlyLoadAppFromAsar === true, 'only-load-from-asar ON')
  ok(FUSE_SPEC.enableEmbeddedAsarIntegrityValidation === true, 'ASAR integrity ON (win/mac)')
  // binary path resolution per platform
  ok(electronBinaryPath('/out', 'win32').endsWith('Aether.exe'), 'win32 exe path')
  ok(electronBinaryPath('/out', 'darwin').includes('Aether.app/Contents/MacOS/Aether'), 'darwin exe path')
  ok(typeof electronBinaryPath('/out', 'linux') === 'string', 'linux exe path resolves')
}

/* ================= 2. hook parses + builder wiring ================= */
console.log('\n[2] hook file + electron-builder wiring')
{
  execFileSync(process.execPath, ['--check', path.join(APP, 'scripts', 'apply-fuses.js')], { stdio: 'pipe' })
  ok(true, 'apply-fuses.js is valid JavaScript')
  const yml = fs.readFileSync(path.join(APP, 'electron-builder.yml'), 'utf8')
  ok(/afterPack:\s*scripts\/apply-fuses\.js/.test(yml), 'afterPack hook wired in electron-builder.yml')
  // real @electron/fuses is installed and exposes the API the hook uses
  const fuses = require('@electron/fuses')
  ok(typeof fuses.flipFuses === 'function' && fuses.FuseVersion && fuses.FuseV1Options, '@electron/fuses installed with flipFuses API')
  ok(fuses.FuseV1Options.RunAsNode !== undefined, 'FuseV1Options.RunAsNode exists')
}

/* ================= 3. SECURITY.md contract ================= */
console.log('\n[3] SECURITY.md — disclosure contract')
{
  const md = fs.readFileSync(path.join(APP, 'SECURITY.md'), 'utf8')
  ok(md.includes('Private vulnerability reporting'), 'points to private reporting')
  ok(md.includes('72 hours'), 'acknowledgment SLA stated')
  ok(md.includes('safe-zip'), 'scope covers the extension extractor')
  ok(md.includes('fuse'), 'posture documents fuse hardening')
  ok(md.includes('Out of scope'), 'scope boundaries explicit')
}

/* ================= 4. Dependabot + CI gate ================= */
console.log('\n[4] supply-chain watchers')
{
  const dep = fs.readFileSync(path.join(APP, '.github', 'dependabot.yml'), 'utf8')
  ok(dep.includes('package-ecosystem: npm') && dep.includes('package-ecosystem: github-actions'), 'dependabot watches npm + actions')
  ok(/interval:\s*weekly/.test(dep), 'weekly cadence')
  const wf = fs.readFileSync(path.join(APP, '.github', 'workflows', 'build.yml'), 'utf8')
  ok(wf.includes('npm audit --audit-level=high'), 'CI gates on npm audit (high+ fails)')
  ok(/Security audit gate/.test(wf), 'audit step is named and greppable')
}

console.log(`\nv1.7.0 build 3 (fuses + security meta): ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
