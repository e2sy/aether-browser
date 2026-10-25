#!/usr/bin/env node
/**
 * Secrets hygiene gate (Master Plan Phase 0, item #18).
 *
 * Scans working-tree files for credential-shaped strings and fails (exit 1)
 * when anything token-like is found. Designed to run in CI and as a
 * pre-commit hook — see docs/SECURITY-HYGIENE.md.
 *
 * Self-exempt by construction: the pattern definitions below never match
 * themselves (each pattern text is followed by `[`, which no character class
 * admits). Fixtures in test-v178.mjs exercise it with real-shaped fakes.
 *
 * Usage:  node scripts/scan-secrets.mjs [dir]     (default: repo root)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'release', 'dist', '.test-v176-tmp'])
const SKIP_FILES = new Set(['package-lock.json'])
const MAX_BYTES = 2 * 1024 * 1024 // don't scan giant generated blobs
const BINARY_SAMPLE = 4096

/**
 * name → regex. Keep patterns tight (24+ entropy chars) so docs and
 * example code never trip them.
 */
const PATTERNS = [
  ['GitHub PAT (fine-grained)', /github_pat_[A-Za-z0-9_]{20,}/g],
  ['GitHub token (classic)', /\bgh[posur]_[A-Za-z0-9]{30,}\b/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY( BLOCK)?-----/g],
  ['Generic credential assignment', /\b(api[_-]?key|secret|token|passwd|password)["']?\s*[:=]\s*["'][A-Za-z0-9+/_-]{24,}["']/gi]
]

function looksBinary(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, BINARY_SAMPLE))
  for (const b of sample) if (b === 0) return true
  return false
}

/** Walk tracked-ish files (respects SKIP_DIRS; git ls-files where available). */
function listFiles() {
  try {
    const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 })
    return out.split('\n').filter(Boolean)
  } catch {
    const files = []
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          if (!SKIP_DIRS.has(ent.name)) walk(p)
        } else files.push(path.relative(ROOT, p))
      }
    }
    walk(ROOT)
    return files
  }
}

const findings = []
for (const rel of listFiles()) {
  if (SKIP_FILES.has(path.basename(rel))) continue
  if (rel.startsWith('.github/') && rel.endsWith('.yml')) {
    // workflow files are scanned like everything else
  }
  const abs = path.join(ROOT, rel)
  let st
  try {
    st = fs.statSync(abs)
  } catch {
    continue
  }
  if (!st.isFile() || st.size > MAX_BYTES) continue
  let buf
  try {
    buf = fs.readFileSync(abs)
  } catch {
    continue
  }
  if (looksBinary(buf)) continue
  const text = buf.toString('utf-8')
  const lines = text.split('\n')
  for (const [name, re] of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const upTo = text.slice(0, m.index)
      const lineNo = upTo.split('\n').length
      findings.push({ file: rel, line: lineNo, kind: name, preview: lines[lineNo - 1].trim().slice(0, 60) })
    }
  }
}

if (findings.length) {
  console.error(`\n✗ scan-secrets: ${findings.length} potential secret(s) found:\n`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.kind}]  ${f.preview}`)
  }
  console.error('\nRotate the credential immediately, purge it from history if needed,')
  console.error('and store it outside the repo (env var / secret manager).')
  console.error('See docs/SECURITY-HYGIENE.md for the rotation runbook.')
  process.exit(1)
} else {
  console.log(`✓ scan-secrets: no credential-shaped strings in ${ROOT}`)
}
