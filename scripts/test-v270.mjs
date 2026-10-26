#!/usr/bin/env node
/**
 * v2.7.0 build 21 — Privacy & Isolation wave:
 *   Aether Containers (Firefox-style isolated tab sessions)
 *   IP masquerade (proxy manager / Tor preset / WebRTC leak shield / check-IP)
 *   Fingerprint farbling (canvas, WebGL, audio, hardware, timezone)
 *   Cookie-banner filter presets
 *
 * Coverage:
 *  - shared/containers.ts (ids, partition naming, registry sanitize, seeds)
 *  - shared/netmask.ts (proxy validation, Chromium rules, precedence, policy,
 *    cloudflare-trace parse, log masking)
 *  - shared/farble.ts (seed math, pools, noise)
 *  - preload/farble.js — FUNCTIONAL: executed under node with stubbed DOM
 *    globals; verifies every patch lands, is deterministic, and the mode-off
 *    gate leaves the page untouched
 *  - static wiring gates across main/preload/renderer/pages
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireCjs = createRequire(import.meta.url)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outdir = path.join(ROOT, '.test-v270-tmp')
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

async function bundleMain(rel, external = []) {
  const { outputFiles } = await build({
    entryPoints: [path.join(ROOT, 'src', rel)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external,
    outfile: path.join(outdir, rel.replace(/[\\/]/g, '_') + '.cjs'),
    write: false,
    logLevel: 'silent'
  })
  const file = path.join(outdir, rel.replace(/[\\/]/g, '_') + '.cjs')
  writeFileSync(file, outputFiles[0].text)
  return requireCjs(file)
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf-8')
}

/* ── shared/containers.ts ─────────────────────────────────────────────────── */
section('containers: identity + partition naming')
const containers = await bundleMain('shared/containers.ts')
{
  ok(containers.isValidContainerId('cabc1234'), 'valid id accepted')
  ok(!containers.isValidContainerId('NO'), 'uppercase rejected')
  ok(!containers.isValidContainerId('c'), 'too short rejected')
  ok(!containers.isValidContainerId('c/../../etc'), 'path junk rejected')
  ok(partitionOK(), 'partitionFor: persist:cnt-<id>')
  function partitionOK() {
    try {
      return containers.partitionFor('cabc1234') === 'persist:cnt-cabc1234'
    } catch {
      return false
    }
  }
  let threw = false
  try {
    containers.partitionFor('BAD ID')
  } catch {
    threw = true
  }
  ok(threw, 'partitionFor throws on bad id (fail-closed)')

  ok(containers.sanitizeContainerName('  Work   stuff ') === 'Work stuff', 'name trimmed/collapsed')
  ok(containers.sanitizeContainerName('') === '', 'empty name rejected')
  ok(containers.sanitizeContainerName('x'.repeat(60)).length === 32, 'name clamped to 32')
  ok(containers.normalizeColor('green') === 'green', 'known color kept')
  ok(containers.normalizeColor('chartreuse') === 'gray', 'unknown color → default')
  ok(containers.normalizeTimezone('Europe/Berlin') === 'Europe/Berlin', 'IANA zone kept')
  ok(containers.normalizeTimezone('UTC') === 'UTC', 'UTC accepted')
  ok(containers.normalizeTimezone('not a zone!') === '', 'garbage zone cleared')
  ok(containers.normalizeTimezone('') === '', 'empty zone cleared')

  const seeds = containers.seedContainers()
  ok(seeds.length === 5, 'five built-in containers seeded')
  ok(new Set(seeds.map((c) => c.id)).size === 5, 'seed ids unique')
  ok(seeds.every((c) => containers.isValidContainerId(c.id)), 'seed ids well-formed')
  ok(seeds.every((c) => c.builtin && c.proxyUrl === '' && c.timezone === ''), 'seeds are clean builtins')
  ok(seeds.some((c) => c.name === 'Anonymous'), 'Anonymous identity present')

  const reg = containers.sanitizeRegistry({
    containers: [
      { id: seeds[0].id, name: 'Work', color: 'blue', ts: 1 },
      { id: 'BAD!', name: 'x' },
      { id: 'cffff00001', name: '' },
      { id: seeds[0].id, name: 'Dup' },
      'junk'
    ]
  })
  ok(reg.containers.length === 1, 'registry keeps only valid entries')
  ok(reg.containers[0].name === 'Work', 'first-wins on duplicate ids')
  ok(containers.sanitizeRegistry(null).containers.length === 0, 'null registry → empty')
  ok(containers.sanitizeRegistry({ containers: 'nope' }).containers.length === 0, 'malformed container list → empty')

  ok(containers.containerById(seeds, seeds[1].id)?.name === seeds[1].name, 'containerById finds')
  ok(containers.containerById(seeds, 'nope') === null, 'containerById misses → null')
  ok(containers.containerById(seeds, null) === null, 'containerById null id → null')

  const named = containers.uniqueName('Work', seeds)
  ok(named === 'Work 2', 'name collision → " 2" suffix')
  ok(containers.uniqueName('Brand new', seeds) === 'Brand new', 'unique name untouched')
}

/* ── shared/netmask.ts ────────────────────────────────────────────────────── */
section('netmask: proxy validation + precedence')
const netmask = await bundleMain('shared/netmask.ts')
{
  ok(netmask.validateProxyUrl('http://proxy.corp:8080') === 'http://proxy.corp:8080', 'http proxy kept')
  ok(netmask.validateProxyUrl('http://proxy.corp') === 'http://proxy.corp:80', 'http default port 80')
  ok(netmask.validateProxyUrl('https://secure.corp:8443') === 'https://secure.corp:8443', 'https proxy kept')
  ok(netmask.validateProxyUrl('socks5://127.0.0.1:9050') === 'socks5://127.0.0.1:9050', 'tor socks kept')
  ok(netmask.validateProxyUrl('socks5://127.0.0.1') === 'socks5://127.0.0.1:1080', 'socks default port 1080')
  ok(netmask.validateProxyUrl('socks5://[::1]:9050') === 'socks5://[::1]:9050', 'ipv6 literal kept')
  ok(netmask.validateProxyUrl('http://user:pw@1.2.3.4:8080') === 'http://1.2.3.4:8080', 'userinfo stripped')
  ok(netmask.validateProxyUrl('ftp://x:21') === null, 'ftp rejected')
  ok(netmask.validateProxyUrl('socks5://host:99999') === null, 'port 99999 rejected')
  ok(netmask.validateProxyUrl('socks5://host:0') === null, 'port 0 rejected')
  ok(netmask.validateProxyUrl('socks5://:9050') === null, 'missing host rejected')
  ok(netmask.validateProxyUrl('http://host:port') === null, 'non-numeric port rejected')
  ok(netmask.validateProxyUrl('http://host/path') === null, 'path rejected')
  ok(netmask.validateProxyUrl('') === null, 'empty rejected')
  ok(netmask.validateProxyUrl(null) === null, 'null rejected')

  ok(netmask.electronProxyString('socks5://127.0.0.1:9050') === 'socks5://127.0.0.1:9050', 'chromium socks form')
  ok(netmask.electronProxyString('http://p:8080') === 'p:8080', 'chromium http form (bare host:port)')
  ok(netmask.electronProxyString('https://p:8443') === 'https=p:8443', 'chromium https form (scheme key)')
  ok(netmask.electronProxyString('junk') === null, 'invalid → null rules')

  ok(
    netmask.effectiveProxyFor('http://own:3128', 'tor', 'http://global:1') === 'http://own:3128',
    'container override wins over tor'
  )
  ok(netmask.effectiveProxyFor('', 'tor', 'http://global:1') === 'socks5://127.0.0.1:9050', 'tor preset applies')
  ok(netmask.effectiveProxyFor('', 'manual', 'socks5://g:1080') === 'socks5://g:1080', 'manual proxy applies')
  ok(netmask.effectiveProxyFor('', 'manual', 'garbage') === null, 'invalid manual → direct (fail-closed)')
  ok(netmask.effectiveProxyFor('garbage', 'tor', '') === 'socks5://127.0.0.1:9050', 'invalid container ignored → tor')
  ok(netmask.effectiveProxyFor('', 'off', '') === null, 'mode off → direct')

  ok(netmask.webrtcPolicy(true, false) === 'disable_non_proxied_udp', 'proxy on → UDP leak shut')
  ok(netmask.webrtcPolicy(false, true) === 'disable_non_proxied_udp', 'shield on → UDP leak shut')
  ok(netmask.webrtcPolicy(false, false) === 'default', 'both off → default')

  const trace = netmask.parseCloudflareTrace('ip=1.2.3.4\nloc=us\nsni=cloudflare.com\n')
  ok(trace && trace.ip === '1.2.3.4' && trace.country === 'US', 'trace parsed (country uppercased)')
  ok(netmask.parseCloudflareTrace('hello world') === null, 'garbage trace rejected')
  ok(netmask.parseCloudflareTrace('ip=<script>alert(1)</script>\nloc=US') === null, 'html in ip rejected')
  ok(netmask.parseCloudflareTrace('loc=DE') === null, 'missing ip rejected')
  ok(netmask.parseCloudflareTrace('x'.repeat(9000)) === null, 'oversized trace rejected')

  ok(netmask.maskIpForLog('1.2.3.4') === '1.2.x.x', 'ipv4 masked in logs')
  ok(netmask.maskIpForLog('2606:4700::6810:85e5').startsWith('2606:4700'), 'ipv6 masked in logs')
  ok(!netmask.maskIpForLog('2606:4700::6810:85e5').includes('6810'), 'ipv6 tail never logged')
  ok(netmask.maskIpForLog('junk') === '<ip>', 'junk ip masked')
  ok(netmask.redactProxyUrl('http://user:pw@1.2.3.4:8080') === 'http://1.2.3.4:8080', 'credentials dropped')
  ok(netmask.normalizeProxyMode('tor') === 'tor', 'mode tor kept')
  ok(netmask.normalizeProxyMode('bogus') === 'off', 'bogus mode → off')
}

/* ── shared/farble.ts ─────────────────────────────────────────────────────── */
section('farble: seed math + pools')
const farble = await bundleMain('shared/farble.ts')
{
  ok(farble.fnv1a('hello') === farble.fnv1a('hello'), 'fnv1a deterministic')
  ok(farble.fnv1a('hello') !== farble.fnv1a('hellp'), 'fnv1a discriminates')
  ok(farble.seedFor('Example.COM', 's') === farble.seedFor('example.com', 's'), 'seed host-normalized')
  ok(farble.seedFor('a.com', 's1') !== farble.seedFor('a.com', 's2'), 'salt changes the seed')
  ok(farble.seedFor('a.com', 's') !== farble.seedFor('b.com', 's'), 'sites diverge')

  const gpu = farble.gpuPairFor(12345)
  ok(gpu.vendor.length > 0 && gpu.renderer.length > 0, 'gpu pair populated')
  ok(farble.gpuPairFor(farble.seedFor('x', 'y')).vendor === farble.gpuPairFor(farble.seedFor('x', 'y')).vendor, 'gpu pair stable per seed')
  ok(farble.HW_CONCURRENCY_POOL.includes(farble.pickFrom(farble.HW_CONCURRENCY_POOL, 7)), 'hw pick from pool')
  const n = farble.noiseAt(99, 0)
  ok([-1, 0, 1].includes(n), 'noise in {-1,0,1}')
  ok(farble.noiseAt(99, 0) === farble.noiseAt(99, 0), 'noise deterministic')
  ok(farble.noiseAt(99, 1) === farble.noiseAt(99, 1) && farble.noiseAt(99, 2) === farble.noiseAt(99, 2), 'noise stable across indexes')
  ok(farble.farbleActive('standard') && !farble.farbleActive('off'), 'farbleActive gate')
  ok(farble.normalizeFarbleMode('standard') === 'standard' && farble.normalizeFarbleMode('x') === 'off', 'mode normalize')
}

/* ── preload/farble.js — FUNCTIONAL (stubbed DOM, node-executed) ─────────── */
section('farble.js: standard mode patches (functional)')

const FARBLE = path.join(ROOT, 'src/preload/farble.js')
const origTzOffset = Date.prototype.getTimezoneOffset
const origResolved = Intl.DateTimeFormat.prototype.resolvedOptions

let g = globalThis
let stubNav = null
function installGlobals(hostname) {
  stubNav = { hardwareConcurrency: 32, deviceMemory: 8, userAgent: 'stub' }
  Object.defineProperty(g, 'navigator', { value: stubNav, configurable: true, writable: true })
  const ctx = {
    drawImage() {},
    putImageData() {},
    getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4)
      data.fill(5) // non-zero base so ±1 noise is observable (clamping keeps 0 at 0)
      return { data, width: w, height: h }
    }
  }
  const mkCanvas = (label) => {
    const c = {
      width: 2,
      height: 2,
      _label: label,
      getContext(t) {
        return t === '2d' ? ctx : null
      },
      toBlob() {}
    }
    c.toDataURL = function () {
      return this._label // must read `this` — the farbled clone gets its own label
    }
    return c
  }
  Object.defineProperty(g, 'location', { value: { hostname }, configurable: true, writable: true })
  g.document = { createElement: () => mkCanvas('CLONED') }
  g.HTMLCanvasElement = { prototype: mkCanvas('ORIG') }
  g.CanvasRenderingContext2D = { prototype: Object.create(ctx) }
  g.CanvasRenderingContext2D.prototype.getImageData = ctx.getImageData
  g.WebGLRenderingContext = {
    prototype: {
      getParameter(p) {
        return 'REAL-' + p
      },
      readPixels(_x, _y, _w, _h, _f, _t, pixels) {
        if (pixels) for (let i = 0; i < pixels.length; i++) pixels[i] = 10
      }
    }
  }
  g.AudioBuffer = {
    prototype: {
      getChannelData(_ch) {
        if (!this._d) this._d = new Float32Array(1000)
        return this._d
      }
    }
  }
  g.window = g
  g.top = g
  delete g.__AETHER_FARBLE__
}

function requireFarble(config, withTestExport = true) {
  delete requireCjs.cache[requireCjs.resolve(FARBLE)]
  process.env.AETHER_FARBLE_TEST_CONFIG = JSON.stringify(config)
  if (withTestExport) process.env.AETHER_FARBLE_TEST = '1'
  else delete process.env.AETHER_FARBLE_TEST
  return requireCjs(FARBLE)
}

const SALT = 'test-salt-27'
// ICU-dependent expectations captured BEFORE farbling patches the realm
const EXPECTED_SHORT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'short' }).format(new Date(0))
installGlobals('Example.COM')
const farbleExports = requireFarble({ mode: 'standard', timezone: 'UTC', salt: SALT })
{
  const SEED = farble.seedFor('example.com', SALT)
  ok(g.__AETHER_FARBLE__, 'marker set on window')
  ok(g.__AETHER_FARBLE__.seed === SEED, 'seed = shared seedFor(host|salt)')
  const applied = g.__AETHER_FARBLE__.applied
  for (const feat of ['canvas', 'webgl', 'audio', 'hardware', 'timezone']) {
    ok(applied.includes(feat), `applied: ${feat}`)
  }

  // canvas — toDataURL goes through the farbled clone
  const url1 = g.HTMLCanvasElement.prototype.toDataURL()
  const url2 = g.HTMLCanvasElement.prototype.toDataURL()
  ok(url1 !== 'ORIG', 'toDataURL is farbled (clone canvas, not the raw one)')
  ok(url1 === url2, 'canvas noise deterministic across calls')

  // getImageData — deterministic stride noise on a buffer big enough to stride
  const big = g.CanvasRenderingContext2D.prototype.getImageData.call(
    { drawImage() {}, putImageData() {}, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) },
    0,
    0,
    32,
    32
  )
  ok(big.data[0] === 5 + farble.noiseAt(SEED, 0), 'getImageData noise matches shared math at stride 0')
  ok(big.data[1] === 5, 'non-stride pixel data untouched')

  // webgl — GPU strings from the believable pool, everything else untouched
  ok(
    g.WebGLRenderingContext.prototype.getParameter(37445) === farble.gpuPairFor(SEED).vendor,
    'UNMASKED_VENDOR_WEBGL spoofed from pool'
  )
  ok(
    g.WebGLRenderingContext.prototype.getParameter(37446) === farble.gpuPairFor(SEED).renderer,
    'UNMASKED_RENDERER_WEBGL spoofed from pool'
  )
  ok(g.WebGLRenderingContext.prototype.getParameter(7936) === 'REAL-7936', 'other getParameter values untouched')

  // readPixels — deterministic stride noise
  const pixels = new Uint8Array(4096)
  g.WebGLRenderingContext.prototype.readPixels(0, 0, 32, 32, 0, 0, pixels)
  const expected0 = Math.max(0, Math.min(255, 10 + farble.noiseAt(SEED, 0)))
  ok(pixels[0] === expected0, 'readPixels noise matches shared math at index 0')
  ok(pixels[1] === 10, 'non-stride pixel untouched')

  // audio — stride noise, once per buffer (WeakSet)
  const audio = { _d: null }
  const d1 = g.AudioBuffer.prototype.getChannelData.call(audio, 0)
  const d2 = g.AudioBuffer.prototype.getChannelData.call(audio, 0)
  ok(d1 === d2, 'audio buffer identity preserved')
  const e0 = farble.noiseAt(SEED, 0) * 1e-7
  ok(Math.abs(d1[0] - e0) < 2e-10, 'audio noise at stride 0 matches shared math')
  ok(d1[1] === 0, 'non-stride audio sample untouched')
  ok(Math.abs(d1[253] - farble.noiseAt(SEED, 253) * 1e-7) < 2e-12, 'audio noise at stride 253 matches (float32 tolerance)')

  // hardware
  ok(navigator.hardwareConcurrency === farble.pickFrom(farble.HW_CONCURRENCY_POOL, SEED), 'hardwareConcurrency rounded into pool')
  ok(stubNav.hardwareConcurrency !== 32, 'real hardwareConcurrency hidden')

  // timezone — UTC override forces offset 0 regardless of the host zone
  ok(new Date().getTimezoneOffset() === 0, 'getTimezoneOffset reports UTC (0)')
  ok(new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone === 'UTC', 'resolvedOptions reports UTC')
  ok(new Date(0).toISOString() === '1970-01-01T00:00:00.000Z', 'Date math unaffected')
  ok(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'short' }).format(new Date(0)) === EXPECTED_SHORT, 'formatting still works under spoof')

  ok(farbleExports && farbleExports.host === 'example.com', 'test hook exposes normalized host')
}

// restore realm-wide patches before the off-scenario
Date.prototype.getTimezoneOffset = origTzOffset
Intl.DateTimeFormat.prototype.resolvedOptions = origResolved

section('farble.js: mode off → zero patching')
installGlobals('shop.example')
requireFarble({ mode: 'off', timezone: '', salt: SALT })
{
  ok(!g.__AETHER_FARBLE__, 'no marker when disabled')
  ok(g.HTMLCanvasElement.prototype.toDataURL() === 'ORIG', 'canvas untouched')
  ok(g.WebGLRenderingContext.prototype.getParameter(37445) === 'REAL-37445', 'webgl untouched')
  ok(navigator.hardwareConcurrency === 32, 'hardware untouched')
  ok(g.AudioBuffer.prototype.getChannelData.call({ _d: null }, 0)[0] === 0, 'audio untouched')
}

// restore realm state for the rest of the suite
Date.prototype.getTimezoneOffset = origTzOffset
Intl.DateTimeFormat.prototype.resolvedOptions = origResolved
delete process.env.AETHER_FARBLE_TEST
delete process.env.AETHER_FARBLE_TEST_CONFIG

/* ── wiring gates ─────────────────────────────────────────────────────────── */
section('wiring: tabs + containers sessions')
{
  const tabs = read('src/main/tabs.ts')
  ok(tabs.includes('partition: partitionFor(tab.containerId)'), 'spawnView uses the container partition')
  ok(tabs.includes('ensureContainerSession(tab.containerId)'), 'container session hardened on spawn')
  ok(tabs.includes('opts?: { containerId?: string | null }'), 'create() takes container opts')
  ok(tabs.includes('moveToContainer'), 'tabs can move between containers')
  ok(tabs.includes('applyWebRTCShield(wc)'), 'every spawned view gets the WebRTC shield')
  ok(tabs.includes('containerId: t.containerId || null'), 'getState exposes containerId')
  ok(tabs.includes('containerId: tab.containerId }'), 'popups inherit the container session')

  const containersMain = read('src/main/containers.ts')
  ok(containersMain.includes('registerShieldsSession(ses)'), 'container sessions join shields')
  ok(containersMain.includes('installPrivacy('), 'container sessions join privacy fortress')
  ok(containersMain.includes('registerFarbleOnSession(ses)'), 'container sessions get farbling')
  ok(containersMain.includes('applySessionProxy(ses, effectiveProxyForContainer(c))'), 'container proxy override applied')
  ok(containersMain.includes('clearStorageData()'), 'container delete wipes storage')

  const adblock = read('src/main/adblock.ts')
  ok(adblock.includes('export function registerShieldsSession'), 'shields accepts extra sessions')
  ok(adblock.includes('for (const extra of extraSessions) sessions.push(extra)'), 'late sessions join ensurePipeline')

  const privacy = read('src/main/privacy.ts')
  ok(privacy.includes('target?: Electron.Session'), 'privacy installs per-session')

  const restore = read('src/main/session-restore.ts')
  ok(restore.includes('containerId?: string | null'), 'session snapshot keeps containerId')
  ok(restore.includes('isValidContainerId'), 'snapshot sanitizes container ids')
  const windows = read('src/main/windows.ts')
  ok(windows.includes('{ containerId: t.containerId ?? null }'), 'restore recreates container tabs')
}

section('wiring: netmask + farble runtime')
{
  const netmaskMain = read('src/main/netmask.ts')
  ok(netmaskMain.includes('setProxy({ mode: \'fixed_servers\', proxyRules: rules })'), 'proxy applied as fixed_servers')
  ok(netmaskMain.includes('setWebRTCIPHandlingPolicy'), 'WebRTC policy set on views')
  ok(netmaskMain.includes('ses.fetch'), 'check-ip fetches through the target session')
  ok(netmaskMain.includes('maskIpForLog'), 'logs never carry full IPs')
  ok(netmaskMain.includes("fromPartition('aether-private')"), 'private session included in the sweep')

  const farbleMain = read('src/main/farble.ts')
  ok(farbleMain.includes("'aether:farble-config'"), 'farble config round-trip channel')
  ok(farbleMain.includes('setPreloads'), 'farble preload registered per session')
  ok(farbleMain.includes('randomBytes'), 'per-boot random salt')

  const farbleJs = read('src/preload/farble.js')
  ok(farbleJs.includes("config.mode !== 'standard'"), 'farble self-gates on mode')
  ok(farbleJs.includes("sendSync('aether:farble-config')"), 'preload asks main for config')
  ok(farbleJs.includes('UNMASKED') || farbleJs.includes('37445'), 'webgl vendor spoof present')
  ok(farbleJs.includes('getTimezoneOffset'), 'timezone override present')
  ok(farbleJs.includes('__AETHER_FARBLE__'), 'double-preload guard present')
  ok(farbleJs.includes('(function () {') && !farbleJs.includes('import '), 'preload is an isolated IIFE (no imports)')

  const index = read('src/main/index.ts')
  ok(index.includes('initContainers()'), 'containers initialized at boot')
  ok(index.includes('initFarble(containerTimezoneFor)'), 'farble config resolver wired')
  ok(index.includes('registerFarbleEverywhere()'), 'farbling registered on boot sessions')
  ok(index.includes('applyProxyEverywhere()'), 'proxy posture applied at boot')

  const vite = read('electron.vite.config.ts')
  ok(vite.includes('copyFarblePreload') && vite.includes('out/preload/farble.js'), 'farble preload shipped by the build')
}

section('wiring: IPC guards + bridge')
{
  const ipc = read('src/main/ipc.ts')
  const channels = [
    'tabs:create',
    'tabs:reopenIn',
    'containers:list',
    'containers:create',
    'containers:update',
    'containers:delete',
    'containers:clearData',
    'netmask:get',
    'netmask:set',
    'netmask:checkIp'
  ]
  for (const c of channels) {
    ok(ipc.includes(`'${c}'`) && ipc.includes(`guard(e, '${c}')`), `guarded channel: ${c}`)
  }
  ok(ipc.includes('moveToContainer(t.id, null)'), 'deleting a container moves its tabs to default')

  const api = read('src/preload/api.ts')
  ok(api.includes('containers: {'), 'bridge: containers group')
  ok(api.includes('netmask: {'), 'bridge: netmask group')
  ok(api.includes('reopenIn'), 'bridge: reopenIn')

  const settings = read('src/main/store.ts')
  ok(settings.includes("farbleMode: 'standard'"), 'farbling on by default')
  ok(settings.includes('webrtcLeakShield: true'), 'WebRTC shield on by default')
  ok(settings.includes("proxyMode: 'off'"), 'proxy off by default')

  const types = read('src/shared/types.ts')
  ok(types.includes('containerId?: string | null'), 'TabMeta carries containerId')
  ok(types.includes('farbleMode'), 'Settings.farbleMode')
  ok(types.includes('webrtcLeakShield'), 'Settings.webrtcLeakShield')
  ok(types.includes('proxyMode'), 'Settings.proxyMode')
}

section('wiring: UI surfaces')
{
  const strip = read('src/renderer/src/components/TabStrip.tsx')
  ok(strip.includes('tab-container-chip'), 'tab strip shows the container chip')
  ok(strip.includes('reopenIn(t.id, c.id)'), 'tab menu reopens into containers')
  ok(strip.includes('Reopen in default session'), 'tab menu can leave a container')

  const css = read('src/renderer/src/styles.css')
  ok(css.includes('.tab-container-chip') && css.includes('.tab-container-dot'), 'chip + dot styles present')

  const pages = read('src/main/pages.ts')
  ok(pages.includes('containers-sec'), 'settings: containers card')
  ok(pages.includes('netmask-sec'), 'settings: IP masking card')
  ok(pages.includes('window.aether.containers.list()'), 'settings renders the container registry')
  ok(pages.includes('window.aether.netmask.checkIp'), 'settings offers Check my IP')
  ok(pages.includes('window.aether.netmask.set('), 'settings applies the proxy')
  ok(pages.includes("save({ farbleMode: e.target.checked ? 'standard' : 'off' })"), 'settings toggles farbling')
  ok(pages.includes("name.textContent = c.name"), 'container names render textContent-only (XSS-safe)')

  const presets = read('src/main/shields-core.ts')
  ok(presets.includes("'ublock-annoyances'"), 'cookie-banner preset: annoyances')
  ok(presets.includes("'easylist-cookie'"), 'cookie-banner preset: easylist cookie')
}

/* ── summary ──────────────────────────────────────────────────────────────── */
console.log(`\n${'='.repeat(50)}`)
console.log(`v2.7.0: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  process.exit(1)
}
try {
  rmSync(outdir, { recursive: true, force: true })
} catch {
  /* windows file locking — the tmp dir is gitignored */
}
