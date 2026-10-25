/**
 * v1.7.0 build 6 — Phase 0 finish: extension quarantine + consent (#4/#5),
 * idle-grant expiry (#13), certificate-error UX (#14).
 *
 * Covers the pure halves of extsec.ts / certs.ts / permissions.ts, plus
 * source-level wiring assertions for the Settings page and the bridge.
 *
 * Run:  node scripts/test-v177.mjs
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
  ok(sa === sb, `${name} (got ${sa?.slice(0, 110)}, want ${sb?.slice(0, 110)})`)
}

/* ---------- bundle extsec.ts (electron stubbed) ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test177-'))
function stubElectron(extra = '') {
  const nm = path.join(tmp, 'node_modules', 'electron')
  fs.mkdirSync(nm, { recursive: true })
  fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }))
  fs.writeFileSync(
    path.join(nm, 'index.js'),
    `module.exports = {
      app: { getPath: () => ${JSON.stringify(path.join(tmp, 'userdata'))}, on() {} },
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      session: { defaultSession: {} },
      BrowserWindow: function () {}
      ${extra}
    }`
  )
}
stubElectron()

async function bundle(srcFile, outName, needsStore = true) {
  const stage = path.join(tmp, path.basename(outName, '.mjs'))
  fs.mkdirSync(stage, { recursive: true })
  fs.cpSync(path.join(APP, 'src', 'main', srcFile), path.join(stage, path.basename(srcFile)))
  if (needsStore) {
    fs.writeFileSync(path.join(stage, 'store.ts'), `export class JsonStore { constructor(_n, d) { this.data = d } save() {} }\nexport function mergedSettings() { return { grantTtlDays: 180 } }\n`)
  }
  const OUTDIR = path.join(APP, `.test-v177-tmp-${outName.replace(/\.mjs$/, '')}`)
  fs.rmSync(OUTDIR, { recursive: true, force: true })
  fs.mkdirSync(OUTDIR, { recursive: true })
  await build({
    entryPoints: [path.join(stage, path.basename(srcFile))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(OUTDIR, outName),
    logLevel: 'silent'
  })
  return import(pathToFileURL(path.join(OUTDIR, outName)).href)
}

const sec = await bundle('extsec.ts', 'extsec.mjs')
const certs = await bundle('certs.ts', 'certs.mjs')
const perms = await bundle('permissions.ts', 'perms.mjs')

console.log('\n── validateManifest — the quarantine gate ──')
eq(sec.validateManifest({ manifest_version: 3, name: 'uBlock Origin', version: '1.60.0' }).ok, true, 'minimal MV3 manifest passes')
const mv2ok = sec.validateManifest({ manifest_version: 2, name: '  Spaced  ', version: '2.1', permissions: ['tabs', '*://*.news.example/*', '<all_urls>'] })
eq(mv2ok.ok, true, 'MV2 manifest with host patterns passes')
eq(mv2ok.name, 'Spaced', 'name trimmed')
eq(mv2ok.permissions, ['tabs'], 'MV2 host-like entries split out of permissions')
eq(mv2ok.hostPermissions, ['*://*.news.example/*', '<all_urls>'], 'MV2 host patterns collected')

eq(sec.validateManifest('not-an-object').ok, false, 'non-object rejected')
eq(sec.validateManifest({ name: 'x', version: '1' }).ok, false, 'missing manifest_version rejected')
eq(sec.validateManifest({ manifest_version: 4, name: 'x', version: '1' }).ok, false, 'manifest_version 4 rejected')
eq(sec.validateManifest({ manifest_version: 3, version: '1' }).ok, false, 'missing name rejected')
eq(sec.validateManifest({ manifest_version: 3, name: '', version: '1' }).ok, false, 'empty name rejected')
eq(sec.validateManifest({ manifest_version: 3, name: 'x'.repeat(201), version: '1' }).ok, false, '200+ char name rejected')
eq(sec.validateManifest({ manifest_version: 3, name: 'x' }).ok, false, 'missing version rejected')
eq(sec.validateManifest({ manifest_version: 3, name: 'x', version: '1.2.3.4.5' }).ok, false, '5-part version rejected')
eq(sec.validateManifest({ manifest_version: 3, name: 'x', version: 'beta' }).ok, false, 'non-numeric version rejected')
eq(sec.validateManifest({ manifest_version: 3, name: 'x', version: '1', description: 5 }).ok, false, 'numeric description rejected')
eq(sec.validateManifest({ manifest_version: 3, name: 'x', version: '1', permissions: 'tabs' }).ok, false, 'string permissions rejected')
eq(sec.validateManifest({ manifest_version: 3, name: 'x', version: '1', host_permissions: [1] }).ok, false, 'non-string host permissions rejected')
eq(sec.validateManifest({ manifest_version: 3, name: 'x', version: '1', permissions: Array.from({ length: 201 }, (_, i) => 'p' + i) }).ok, false, '201 permissions rejected')

console.log('\n── validateManifestOnDisk — bad JSON never reaches the loader ──')
const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-ext177-'))
fs.writeFileSync(path.join(stageDir, 'manifest.json'), '{ oops')
eq(sec.validateManifestOnDisk(stageDir).ok, false, 'invalid JSON rejected')
fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'Good', version: '1.0' }))
eq(sec.validateManifestOnDisk(stageDir).ok, true, 'valid manifest on disk passes')

console.log('\n── permissionSummary — Chrome-style consent lines ──')
const lines1 = sec.permissionSummary({ ok: true, name: 'A', version: '1', permissions: ['tabs', 'cookies', 'tabs'], hostPermissions: [] })
ok(lines1.includes('Read your browsing activity and tab contents'), 'tabs label present')
ok(lines1.includes('Read and change cookies on all sites'), 'cookies label present')
eq(lines1.length, 2, 'duplicate permission collapses')
const lines2 = sec.permissionSummary({ ok: true, name: 'A', version: '1', permissions: [], hostPermissions: ['<all_urls>'] })
eq(lines2, ['Read and change all your data on all websites'], '<all_urls> summarized')
const lines3 = sec.permissionSummary({ ok: true, name: 'A', version: '1', permissions: [], hostPermissions: ['*://*.mail.example.com/*', 'https://shop.io/*', '*://a.dev/*', '*://b.dev/*', '*://c.dev/*'] })
eq(lines3.length, 4, 'host list capped at 3 + one "and N more"')
ok(lines3[3].includes('and 2 more'), 'extra count correct')
eq(lines3[0], 'Read and change your data on mail.example.com', 'wildcard subdomain stripped to domain')
const lines4 = sec.permissionSummary({ ok: true, name: 'A', version: '1', permissions: ['super_custom_api'], hostPermissions: [] })
eq(lines4, ['super_custom_api'], 'unknown permission passes through raw')
eq(sec.permissionSummary({ ok: false, error: 'x' }), [], 'invalid verdict → empty summary')

console.log('\n── isHighRisk ──')
eq(sec.isHighRisk({ ok: true, permissions: ['alarms'], hostPermissions: [] }), false, 'benign permissions are not risky')
eq(sec.isHighRisk({ ok: true, permissions: ['debugger'], hostPermissions: [] }), true, 'debugger is risky')
eq(sec.isHighRisk({ ok: true, permissions: [], hostPermissions: ['*://x/*'] }), true, 'any host permission is risky')
eq(sec.isHighRisk({ ok: true, permissions: ['nativeMessaging'], hostPermissions: [] }), true, 'nativeMessaging is risky')

console.log('\n── consentKey — path + version memory ──')
eq(sec.consentKey('/tmp/ext', '1.2'), path.resolve('/tmp/ext') + '::1.2', 'key is resolved path + version')
ok(sec.consentKey('/tmp/ext/', '1.2') === sec.consentKey('/tmp/ext', '1.2'), 'trailing slash normalized')

console.log('\n── grant expiry (#13) ──')
const DAY = 86_400_000
const fresh = { origin: 'https://x', permission: 'media', decision: 'allow', ts: 1000 * DAY }
eq(perms.isGrantExpired(fresh, 1001 * DAY, 180), false, 'fresh grant survives')
eq(perms.isGrantExpired(fresh, 1180 * DAY, 180), false, 'grant exactly at TTL boundary survives')
eq(perms.isGrantExpired(fresh, 1181 * DAY, 180), true, 'grant one day past TTL expires')
eq(perms.isGrantExpired(fresh, 1001 * DAY, 0), false, 'ttl 0 = never expires')
eq(perms.isGrantExpired(fresh, 1001 * DAY, -5), false, 'negative ttl treated as never')
eq(perms.isGrantExpired({ ts: 'bogus' }, 1000 * DAY, 180), true, 'corrupt ts expires fail-closed')

const sweepIn = {
  a: { origin: 'https://a', permission: 'media', decision: 'allow', ts: 0 },
  b: { origin: 'https://b', permission: 'media', decision: 'block', ts: 999 * DAY },
  c: { origin: 'https://c', permission: 'geolocation', decision: 'allow', ts: 1910 * DAY }
}
const [swept, n] = perms.sweepGrantData(sweepIn, 2000 * DAY, 180)
eq(n, 2, 'two stale grants swept')
eq(Object.keys(swept), ['c'], 'only the fresh grant survives')
eq(perms.sweepGrantData(sweepIn, 2000 * DAY, 0)[1], 0, 'ttl 0 sweeps nothing')

console.log('\n── certificate memo policy (#14) — no silent bypass, 24h, per cert ──')
const NOW = 1_700_000_000_000
eq(certs.certMemoVerdict(undefined, NOW), 'deny', 'no memo = deny')
eq(certs.certMemoVerdict({ ts: NOW }, NOW), 'allow', 'fresh memo = allow')
eq(certs.certMemoVerdict({ ts: NOW - 24 * 3600_000 }, NOW), 'allow', 'memo exactly 24h old still allows')
eq(certs.certMemoVerdict({ ts: NOW - 24 * 3600_000 - 1 }, NOW), 'deny', 'memo 24h+1ms is stale = deny')
eq(certs.certMemoVerdict({ ts: NOW + 1000 }, NOW), 'deny', 'memo from the future = deny (clock games fail closed)')
eq(certs.certMemoVerdict({ ts: NOW }, NOW, 0), 'deny', 'ttl 0 = memo system disabled')

eq(certs.hostOf('https://shop.example.com:8443/path?q=1'), 'shop.example.com:8443', 'host keeps port')
eq(certs.hostOf('not a url'), 'not a url', 'garbage falls back to raw string')

console.log('\n── wiring — Settings page, bridge and IPC ──')
const pagesSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'pages.ts'), 'utf-8')
ok(pagesSrc.includes("id=\"grantTtl\"") || pagesSrc.includes("id='grantTtl'"), 'settings page has grant-TTL selector')
ok(pagesSrc.includes('id="certForget"') || pagesSrc.includes("id='certForget'"), 'settings page has certificate-exception forget button')
ok(pagesSrc.includes('grantTtlDays'), 'settings page loads/saves grantTtlDays')
ok(pagesSrc.includes('certs.forget()'), 'forget button calls the bridge')
const apiSrc = fs.readFileSync(path.join(APP, 'src', 'preload', 'api.ts'), 'utf-8')
ok(apiSrc.includes("invoke('certs:forget')"), 'bridge exposes certs.forget')
ok(apiSrc.includes("invoke('perms:sweep')"), 'bridge exposes perms.sweep')
const ipcSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'ipc.ts'), 'utf-8')
ok(ipcSrc.includes("ipcMain.handle('certs:forget'"), 'ipc handles certs:forget')
ok(ipcSrc.includes("ipcMain.handle('perms:sweep'"), 'ipc handles perms:sweep')
const idxSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'index.ts'), 'utf-8')
ok(idxSrc.includes('installCertificateHandlers()'), 'boot installs the certificate policy')
ok(idxSrc.includes('sweepExpiredGrants()'), 'boot sweeps expired grants')
const crxSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'crx.ts'), 'utf-8')
ok(crxSrc.includes('MAX_EXT_PACKAGE_BYTES'), 'crx flow enforces the package size cap')
ok(crxSrc.includes('validateManifestOnDisk'), 'crx flow validates the manifest pre-load')
ok(crxSrc.includes('ownStaging: true'), 'crx flow wipes its staging dir on failure')
const extSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'extensions.ts'), 'utf-8')
ok(extSrc.includes('ensureExtensionConsent'), 'unpacked flow goes through consent')
ok(extSrc.includes('ownStaging'), 'installer supports own-staging wipe')
const typesSrc = fs.readFileSync(path.join(APP, 'src', 'shared', 'types.ts'), 'utf-8')
ok(typesSrc.includes('grantTtlDays'), 'Settings type declares grantTtlDays')
const storeSrc = fs.readFileSync(path.join(APP, 'src', 'main', 'store.ts'), 'utf-8')
ok(storeSrc.includes('grantTtlDays: 180'), 'default grant TTL is 180 days')

/* ---------- cleanup + report ---------- */
fs.rmSync(tmp, { recursive: true, force: true })
for (const d of fs.readdirSync(APP)) {
  if (d.startsWith('.test-v177-tmp')) fs.rmSync(path.join(APP, d), { recursive: true, force: true })
}
console.log(`\n═══ test-v177: ${pass} passed, ${fail} failed ═══`)
if (fail > 0) process.exit(1)
