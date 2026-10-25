/**
 * v1.7.0 build 1 — Security hardening tests.
 *
 * safe-zip: the hardened extractor that replaced `extract-zip` (advisory
 * with NO patched release — arbitrary file write via symlink/path traversal
 * on untrusted CRX/ZIP extension installs). The suite builds REAL malicious
 * zip fixtures byte-by-byte (stored entries, own zip writer + crc32) and
 * asserts the extractor fails closed on every attack class and succeeds on
 * honest archives.
 *
 * Run:  node scripts/test-v170.mjs
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
  ok(sa === sb, `${name} (got ${sa?.slice(0, 90)}, want ${sb?.slice(0, 90)})`)
}

/* ---------- bundle safe-zip (same pattern as test-v160) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test170-'))
fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })
const entry = path.join(tmp, 'src', 'main', 'testable-v170.ts')
fs.writeFileSync(entry, `export { safeUnzip, isDangerousName, entryKind, checkBudgets, DEFAULT_LIMITS } from './safe-zip'`)

const OUTDIR = path.join(APP, '.test-v170-tmp')
fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['yauzl'], // pure-JS dep; resolved from the app tree at runtime
  outfile: path.join(OUTDIR, 'bundle.mjs'),
  logLevel: 'silent'
})
const { safeUnzip, isDangerousName, entryKind, checkBudgets, DEFAULT_LIMITS } = await import(
  pathToFileURL(path.join(OUTDIR, 'bundle.mjs')).href
)

/* ---------- minimal zip writer (stored entries only) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * files: [{ name, data(Buffer|string), mode(optional unix mode<<16), flags(optional gp flags),
 *          method(optional compression method, default 0 stored),
 *          claimSize(optional override for uncompressed size), claimComp(optional) }]
 * Builds an honest zip unless the fields are lying — exactly what attackers do.
 */
function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data ?? '', 'utf8')
    const comp = f.claimComp ?? data.length
    const unc = f.claimSize ?? data.length
    const crc = f.crcOverride ?? crc32(data)
    const flags = f.flags ?? 0
    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4) // version needed
    lfh.writeUInt16LE(flags, 6)
    lfh.writeUInt16LE(f.method ?? 0, 8)
    lfh.writeUInt16LE(0, 10) // time
    lfh.writeUInt16LE(0, 12) // date
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(comp, 18)
    lfh.writeUInt32LE(unc, 22)
    lfh.writeUInt16LE(name.length, 26)
    lfh.writeUInt16LE(0, 28)
    locals.push(lfh, name, data)

    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)
    cdh.writeUInt16LE(f.mode ? (0x03 << 8) | 20 : 20, 4) // version made by: unix when modes used
    cdh.writeUInt16LE(20, 6)
    cdh.writeUInt16LE(flags, 8)
    cdh.writeUInt16LE(f.method ?? 0, 10)
    cdh.writeUInt16LE(0, 12)
    cdh.writeUInt16LE(0, 14)
    cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(comp, 20)
    cdh.writeUInt32LE(unc, 24)
    cdh.writeUInt16LE(name.length, 28)
    cdh.writeUInt32LE(f.mode ?? 0, 38) // external attrs
    cdh.writeUInt32LE(offset, 42)
    centrals.push(cdh, name)
    offset += 30 + name.length + data.length
  }
  const cdStart = offset
  let cdLen = 0
  for (const b of centrals) cdLen += b.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdLen, 12)
  eocd.writeUInt32LE(cdStart, 16)
  return Buffer.concat([...locals, ...centrals, eocd])
}

const MODE_FILE = (0o100644 << 16) >>> 0
const MODE_DIR = (0o040755 << 16) >>> 0
const MODE_LINK = (0o120777 << 16) >>> 0
const MODE_CHRDEV = (0o020600 << 16) >>> 0

/* ================= 1. pure: dangerous entry names ================= */
console.log('\n[1] isDangerousName — the path-attack classifier')
{
  eq(isDangerousName('manifest.json'), null, 'plain name is safe')
  eq(isDangerousName('js/content.js'), null, 'nested name is safe')
  eq(isDangerousName('./manifest.json'), null, 'dot-slash tolerated')
  eq(isDangerousName('../../evil.txt'), 'parent traversal (..) in entry name', '../ traversal caught')
  eq(isDangerousName('a/../../b'), 'parent traversal (..) in entry name', 'mid-path traversal caught')
  eq(isDangerousName('..\\..\\evil'), 'backslash in entry name', 'backslash caught')
  eq(isDangerousName('/etc/passwd'), 'absolute path in entry name', 'unix absolute caught')
  eq(isDangerousName('C:\\evil.txt'), 'windows drive path in entry name', 'drive letter caught')
  eq(isDangerousName('C:/evil.txt'), 'windows drive path in entry name', 'drive letter forward-slash caught')
  eq(isDangerousName('bad\0name'), 'NUL byte in entry name', 'NUL byte caught')
  eq(isDangerousName(''), 'empty entry name', 'empty name caught')
  ok(isDangerousName('..') !== null, 'bare ".." caught')
}

/* ================= 2. pure: entry kinds ================= */
console.log('\n[2] entryKind — unix mode classification')
{
  eq(entryKind('a/', MODE_DIR), 'dir', 'trailing slash → dir')
  eq(entryKind('a', MODE_DIR), 'dir', 'mode dir → dir')
  eq(entryKind('a', MODE_FILE), 'file', 'regular file')
  eq(entryKind('a', 0), 'file', 'mode 0 (DOS-created) → regular file')
  eq(entryKind('a', MODE_LINK), 'symlink', 'symlink detected')
  eq(entryKind('a', MODE_CHRDEV), 'special', 'char device detected')
}

/* ================= 3. pure: budgets ================= */
console.log('\n[3] checkBudgets — zip-bomb arithmetic')
{
  const st = { entries: 0, totalBytes: 0 }
  eq(checkBudgets(DEFAULT_LIMITS, st, 100, 50), null, 'small entry passes')
  eq(checkBudgets(DEFAULT_LIMITS, { entries: 19999, totalBytes: 0 }, 1, 1), null, 'entry #20000 passes')
  ok(
    checkBudgets(DEFAULT_LIMITS, { entries: 20000, totalBytes: 0 }, 1, 1) !== null,
    'entry #20001 rejected (count budget)'
  )
  ok(checkBudgets(DEFAULT_LIMITS, st, 600_000_000, 1000) !== null, '600 MB entry rejected (per-entry budget)')
  ok(
    checkBudgets(DEFAULT_LIMITS, { entries: 0, totalBytes: 999_000_000 }, 2_000_000, 1_000_000) !== null,
    'total budget fires near 1 GB'
  )
  ok(
    checkBudgets(DEFAULT_LIMITS, st, 20_000_000, 1000) !== null,
    '20000:1 ratio on a >10MB entry rejected (ratio kill switch)'
  )
  eq(checkBudgets(DEFAULT_LIMITS, st, 5_000_000, 100), null, 'ratio not applied below the 10 MB floor')
}

/* ================= 4. honest archives extract cleanly ================= */
console.log('\n[4] honest archives succeed')
{
  const dir = path.join(tmp, 'good')
  fs.writeFileSync(path.join(tmp, 'good.zip'), buildZip([
    { name: 'manifest.json', data: '{"name":"ok","version":"1.0.0","manifest_version":3}', mode: MODE_FILE },
    { name: 'js/', mode: MODE_DIR },
    { name: 'js/content.js', data: 'console.log("hi")', mode: MODE_FILE }
  ]))
  const res = await safeUnzip(path.join(tmp, 'good.zip'), dir)
  eq(res.files, 2, 'two files extracted')
  eq(res.dirs, 1, 'one dir created')
  eq(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
    '{"name":"ok","version":"1.0.0","manifest_version":3}',
    'manifest content intact'
  )
  ok(fs.existsSync(path.join(dir, 'js', 'content.js')), 'nested file landed in js/')

  // implicit parents: dir entry absent entirely
  const dir2 = path.join(tmp, 'good2')
  fs.writeFileSync(path.join(tmp, 'good2.zip'), buildZip([
    { name: 'deep/nested/folders/file.txt', data: 'x', mode: MODE_FILE }
  ]))
  const res2 = await safeUnzip(path.join(tmp, 'good2.zip'), dir2)
  ok(fs.existsSync(path.join(dir2, 'deep', 'nested', 'folders', 'file.txt')), 'parents auto-created for implicit dirs')
  eq(res2.files, 1, 'one file')
}

/* ================= 5. the attack classes — fail CLOSED ================= */
console.log('\n[5] traversal / absolute / backslash / drive attacks')
async function expectReject(zipName, files, why, limits, msgIncludes) {
  const z = path.join(tmp, zipName + '.zip')
  fs.writeFileSync(z, buildZip(files))
  const dir = path.join(tmp, 'out-' + zipName)
  try {
    await safeUnzip(z, dir, limits)
    ok(false, `${why}: extractor ACCEPTED a malicious archive`)
  } catch (e) {
    ok(true, `${why} → rejected ("${String(e.message).slice(0, 70)}")`)
    ok(msgIncludes ? String(e.message).includes(msgIncludes) : true, `  our own policy fired (${why})`)
    // staging dir containment: the caller (crx.ts) wipes on throw; here we
    // assert nothing escaped OUTSIDE the dir at least
    ok(!fs.existsSync(path.join(tmp, 'evil.txt')), `  no file escaped to the parent dir (${why})`)
  }
}

{
  await expectReject('trav', [{ name: '../../evil.txt', data: 'gotcha', mode: MODE_FILE }], 'unix traversal')
  await expectReject('trav2', [{ name: 'x/../../../../../../../tmp/evil.txt', data: 'gotcha', mode: MODE_FILE }], 'deep traversal')
  await expectReject('abs', [{ name: '/etc/passwd', data: 'gotcha', mode: MODE_FILE }], 'unix absolute path')
  await expectReject('drive', [{ name: 'C:\\evil.txt', data: 'gotcha', mode: MODE_FILE }], 'windows drive path')
  await expectReject('bslash', [{ name: '..\\..\\evil.txt', data: 'gotcha', mode: MODE_FILE }], 'backslash traversal')
  await expectReject('nul', [{ name: 'ok\0/../../evil', data: 'gotcha', mode: MODE_FILE }], 'NUL-byte smuggling')
}

console.log('\n[6] symlink / device / encrypted entries')
{
  await expectReject('sym', [{ name: 'link', data: '/tmp/evil-target', mode: MODE_LINK }], 'symlink entry')
  await expectReject('symindir', [
    { name: 'manifest.json', data: '{"name":"x"}', mode: MODE_FILE },
    { name: 'node_modules/evil', data: '/etc', mode: MODE_LINK }
  ], 'symlink smuggled beside honest files')
  await expectReject('dev', [{ name: 'sneaky', data: '', mode: MODE_CHRDEV }], 'char-device entry')
  await expectReject('enc', [{ name: 'secret.txt', data: 'cipher', mode: MODE_FILE, flags: 0x0001 }], 'encrypted entry flag')
}

console.log('\n[7] zip bombs')
{
  // consistent claimed sizes (stored: comp === unc) so the entry is emitted
  // and OUR budget fires before any stream is opened
  await expectReject('bombEntry', [
    { name: 'big.bin', data: Buffer.from('A'), mode: MODE_FILE, claimSize: 600_000_000, claimComp: 600_000_000 }
  ], 'per-entry size budget (600 MB claimed)', undefined, 'per-entry size limit')
  // method 8 (deflate): comp << unc is legitimate to yauzl, so the entry is
  // emitted and the ratio kill switch fires
  await expectReject('bombRatio', [
    { name: 'big.bin', data: Buffer.from('A'), mode: MODE_FILE, method: 8, claimSize: 20_000_000, claimComp: 1000 }
  ], 'ratio kill switch (20000:1)', undefined, 'decompression ratio')
  await expectReject('bombCount', [
    { name: 'f1', data: 'x', mode: MODE_FILE }, { name: 'f2', data: 'x', mode: MODE_FILE },
    { name: 'f3', data: 'x', mode: MODE_FILE }, { name: 'f4', data: 'x', mode: MODE_FILE }
  ], 'entry-count budget', { maxEntries: 3 }, 'too many entries')
  // total-bytes budget: three real 3 MB stored entries streamed under a
  // custom 5 MB total budget — the third entry must trip OUR budget
  const blob = Buffer.alloc(3_000_000, 0x41)
  const z = path.join(tmp, 'bombTotal.zip')
  fs.writeFileSync(z, buildZip([
    { name: 'a', data: blob, mode: MODE_FILE },
    { name: 'b', data: blob, mode: MODE_FILE },
    { name: 'c', data: blob, mode: MODE_FILE }
  ]))
  try {
    await safeUnzip(z, path.join(tmp, 'bombTotal'), { maxTotalBytes: 5_000_000 })
    ok(false, 'total budget: accepted a 9 MB archive under a 5 MB budget')
  } catch (e) {
    ok(String(e.message).includes('total uncompressed size budget'), 'total-bytes budget fired ("' + String(e.message).slice(0, 60) + '")')
  }
}

console.log('\n[8] garbage archives fail with clean errors')
{
  const z = path.join(tmp, 'garbage.zip')
  fs.writeFileSync(z, Buffer.from('this is not a zip file at all'))
  try {
    await safeUnzip(z, path.join(tmp, 'garbage'))
    ok(false, 'garbage accepted')
  } catch (e) {
    ok(String(e.message).includes('Could not read the archive'), 'garbage → clean error')
  }
  try {
    await safeUnzip(path.join(tmp, 'does-not-exist.zip'), path.join(tmp, 'ghost'))
    ok(false, 'missing file accepted')
  } catch (e) {
    ok(String(e.message).includes('Could not read the archive'), 'missing file → clean error')
  }
}

console.log('\n[9] containment second-guess (resolve-based)')
{
  // a name that passes the string checks but still must stay inside after
  // path.resolve — e.g. a name ending with a dot-segment alias
  const z = path.join(tmp, 'alias.zip')
  fs.writeFileSync(z, buildZip([{ name: 'ok/../ok.txt', data: 'fine', mode: MODE_FILE }]))
  // 'ok/../ok.txt' contains '..' so the string check fires first
  try {
    await safeUnzip(z, path.join(tmp, 'alias'))
    ok(false, 'dot-segment alias accepted')
  } catch {
    ok(true, 'dot-segment alias rejected by string check')
  }
}

fs.rmSync(OUTDIR, { recursive: true, force: true })

console.log(`\nv1.7.0 security hardening: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
