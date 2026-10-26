#!/usr/bin/env node
/**
 * v2.5.0 build 19 — reader view + screenshot tool + picture-in-picture +
 * task manager.
 *
 * Coverage:
 *  - reader sanitizer (whitelist rebuild: tags, attributes, URL schemes,
 *    relative-URL resolution, form/media stripping) — bundled from
 *    src/main/reader.ts with jsdom/readability/electron external
 *  - task-manager metrics mapping (tab refs, interface rows, kill targets,
 *    CPU smoothing across polls, dead-pid GC, memory sort/total)
 *  - shared fmt helpers (shot filename pattern, reading time, bytes/pct)
 *  - static wiring gates (pages registered, menu accelerators, IPC guards,
 *    textContent-only task-manager page, preload bridge groups)
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const requireCjs = createRequire(import.meta.url)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// bundles must live INSIDE the app tree so require('jsdom') resolves
const outdir = path.join(ROOT, '.test-v250-tmp')
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

async function bundleMain(rel, external) {
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

// ── reader sanitizer ─────────────────────────────────────────────────────────
section('reader: sanitizeArticleElement whitelist')
const reader = await bundleMain('main/reader.ts', ['electron', 'jsdom', '@mozilla/readability'])

const BASE = 'https://example.com/post/why-aether'
function sanitize(html) {
  const dom = new JSDOM(html, { url: BASE })
  return reader.sanitizeArticleElement(dom.window.document.body, BASE)
}

{
  const out = sanitize('<p onclick="steal()">Hi <b>there</b></p><script>alert(1)</script>')
  ok(out.includes('<p>Hi <b>there</b></p>'), 'strips on* attributes, keeps p/b')
  ok(!out.includes('script') && !out.includes('alert'), 'script subtree removed')
}
{
  const out = sanitize('<div><style>.x{}</style><iframe src="https://evil"></iframe><p>kept</p></div>')
  ok(out.includes('<p>kept</p>'), 'style/iframe removed, content kept')
}
{
  const out = sanitize('<a href="javascript:alert(1)">bad</a><a href="https://ok.example/x">good</a>')
  ok(!out.includes('javascript:'), 'javascript: href dropped')
  ok(out.includes('https://ok.example/x'), 'https href kept')
}
{
  const out = sanitize('<img src="/img/pic.png" alt="pic">')
  ok(out.includes('https://example.com/img/pic.png'), 'relative img src resolved against article origin')
}
{
  const out = sanitize('<img src="data:image/png;base64,AAAA">')
  ok(!out.includes('data:image'), 'data: img src dropped (CSP img-src is https:/data: — keep defense in depth tight)')
}
{
  const out = sanitize('<a href="data:text/html,<b>x</b>">d</a>')
  ok(!out.includes('data:text/html'), 'data: link dropped')
}
{
  const out = sanitize('<form action="/x"><input value="y"><p>text</p></form><button>no</button>')
  ok(!out.includes('<form') && !out.includes('<input') && !out.includes('<button'), 'form controls removed')
}
{
  const out = sanitize('<video src="/v.mp4"></video><audio src="/a.mp3"></audio><p>ok</p>')
  ok(!out.includes('video') && !out.includes('audio'), 'media elements removed from articles')
}
{
  const out = sanitize('<main><font size="3"><p>unwrapped</p></font></main>')
  ok(out.includes('<p>unwrapped</p>') && !out.includes('<main') && !out.includes('<font'), 'presentation wrappers unwrapped, text kept')
}
{
  const out = sanitize('<span></span><span>  </span><p>real</p>')
  ok(!/<span><\/span>/.test(out.replace(/<span>\s*<\/span>/g, '')), 'empty span leaves stripped')
}
{
  const out = sanitize('<h2>Title</h2><ul><li>a</li></ul><blockquote><em>q</em></blockquote><table><tr><td>c</td></tr></table>')
  ok(out.includes('<h2>') && out.includes('<ul>') && out.includes('<blockquote>') && out.includes('<table>'), 'article tags survive (h2/ul/blockquote/table)')
}
{
  const out = sanitize('<a href="/rel/link">r</a>')
  ok(out.includes('https://example.com/rel/link'), 'relative link resolved')
}
{
  const out = sanitize('<img src="https://cdn.example/i.png" onerror="x()" style="width:1px" title="t">')
  ok(!out.includes('onerror') && !out.includes('style='), 'event/style attributes stripped')
  ok(out.includes('title="t"'), 'whitelisted title attr kept')
}

// ── task metrics mapping ─────────────────────────────────────────────────────
section('task manager: mapTaskMetrics')
const tm = await bundleMain('shared/taskmetrics.ts', [])

const TABS = [
  { winId: 1, tabId: 11, title: 'Hacker News', url: 'https://news.ycombinator.com', pid: 100 },
  { winId: 1, tabId: 12, title: 'Docs', url: 'https://docs.example.com', pid: 101 },
  { winId: 1, tabId: -1, title: 'Aether interface', url: '', pid: 102, isInterface: true }
]
const METRICS = [
  { pid: 50, type: 'Browser', cpu: { percentCPUUsage: 1.0 }, memory: { workingSetSize: 120000 } },
  { pid: 60, type: 'GPU', cpu: { percentCPUUsage: 0.5 }, memory: { workingSetSize: 90000 } },
  { pid: 70, type: 'Utility', service: 'network.mojom.NetworkService', cpu: { percentCPUUsage: 0.2 }, memory: { workingSetSize: 40000 } },
  { pid: 100, type: 'Tab', cpu: { percentCPUUsage: 2.0 }, memory: { workingSetSize: 250000 } },
  { pid: 101, type: 'Tab', cpu: { percentCPUUsage: 0.1 }, memory: { workingSetSize: 80000 } },
  { pid: 102, type: 'Tab', cpu: { percentCPUUsage: 0.3 }, memory: { workingSetSize: 150000 } }
]

{
  const s1 = tm.mapTaskMetrics(METRICS, TABS, {}, 10_000)
  ok(s1.rows.length === 6, 'all processes mapped')
  const tabRow = s1.rows.find((r) => r.label === 'Hacker News')
  ok(!!tabRow, 'tab row matched by pid')
  ok(tabRow.kind === 'tab' && tabRow.kill && tabRow.kill.tabId === 11 && tabRow.kill.winId === 1, 'tab row carries kill target (winId+tabId)')
  const iface = s1.rows.find((r) => r.label === 'Aether interface')
  ok(iface.kind === 'interface' && !iface.kill, 'interface row labeled and NOT killable')
  ok(s1.rows.find((r) => r.label === 'GPU process'), 'GPU labeled')
  const util = s1.rows.find((r) => r.label === 'Utility')
  ok(util && util.sublabel === 'network.mojom.NetworkService', 'utility keeps service sublabel')
  ok(s1.rows[0].memBytes >= s1.rows[s1.rows.length - 1].memBytes, 'rows sorted by memory desc')
  ok(s1.totalMemBytes === 730000 * 1024, 'total memory = sum of working sets (KB→B)')
  ok(s1.rows.every((r) => r.cpuPct === 0), 'first poll reports 0% (no previous sample)')

  // second poll — CPU smoothing = (cur - prev) / elapsed
  const cur = METRICS.map((m) => ({ ...m, cpu: { percentCPUUsage: m.cpu.percentCPUUsage + 0.5 } }))
  const s2 = tm.mapTaskMetrics(cur, TABS, s1.next, 11_000)
  const hn2 = s2.rows.find((r) => r.label === 'Hacker News')
  ok(Math.abs(hn2.cpuPct - 0.5) < 1e-9, 'CPU% = delta/elapsed (0.5 over 1s → 0.5%)')

  // dead pid falls out of the smoothing map
  ok(s1.next[100] && s1.next[50], 'prev map tracks live pids')
  const s3 = tm.mapTaskMetrics(METRICS.filter((m) => m.pid !== 100), TABS, s2.next, 12_000)
  ok(!s3.next[100] && !s3.rows.some((r) => r.label === 'Hacker News'), 'dead pid row + smoothing entry GCed')
}
{
  // tabs with undefined pid never crash the mapping
  const s = tm.mapTaskMetrics(METRICS, [{ winId: 2, tabId: 99, title: 'X', url: 'https://x', pid: undefined }], {}, 1_000)
  ok(!s.rows.some((r) => r.kill && r.kill.tabId === 99), 'tab without pid is not presented as killable')
}

// ── shared fmt ───────────────────────────────────────────────────────────────
section('shared fmt helpers')
const fmt = await bundleMain('shared/fmt.ts', [])
ok(/^aether-\d{4}-\d{2}-\d{2}-\d{6}\.png$/.test(fmt.shotFilename(new Date(2026, 9, 26, 14, 25, 33))), 'shot filename pattern (date + hhmmss)')
ok(fmt.shotFilename(new Date(2026, 0, 5, 3, 4, 5)) === 'aether-2026-01-05-030405.png', 'shot filename zero-pads')
ok(fmt.readingTimeMin(530) === 2 && fmt.readingTimeMin(0) === 1, 'reading time at 265 wpm, min 1')
ok(fmt.fmtBytes(1536) === '1.5 KB' && fmt.fmtBytes(250 * 1024 * 1024) === '250 MB', 'fmtBytes KB/MB')
ok(fmt.fmtPct(0.02) === '0%' && fmt.fmtPct(1.24) === '1.2%' && fmt.fmtPct(31.4) === '31%', 'fmtPct bands')
ok(fmt.truncate('x'.repeat(80), 72).length === 72 && fmt.truncate('short', 72) === 'short', 'truncate')

// ── static wiring gates ──────────────────────────────────────────────────────
section('wiring: pages')
const pages = readFileSync(path.join(ROOT, 'src/main/pages.ts'), 'utf-8')
ok(pages.includes('export const READER_HTML = pageShell('), 'reader page via pageShell (nonce CSP inherited)')
ok(pages.includes('export const TASKMGR_HTML = pageShell('), 'task-manager page via pageShell')
ok(pages.includes('id="rd-content"') && pages.includes('id="rd-title"') && pages.includes('id="rd-meta"'), 'reader page has title/meta/content slots')
ok(pages.includes('id="tm-rows"') && pages.includes('id="tm-total"'), 'task-manager table slots present')
ok(pages.includes('window.aether.reader.get()'), 'reader page pulls the stored article over the bridge')
ok(pages.includes('window.aether.taskmgr.snapshot()') && pages.includes('window.aether.taskmgr.kill('), 'task-manager page wired to snapshot+kill')
{
  const script = pages.split('export const TASKMGR_HTML')[1] || ''
  ok(!/innerHTML/.test(script), 'task-manager page is textContent-only (no innerHTML sinks)')
}
{
  const readerScript = pages.split('export const READER_HTML')[1]?.split('export const TASKMGR_HTML')[0] || ''
  ok(readerScript.includes('content.innerHTML = a.content'), 'reader renders sanitized article (single documented sink)')
  ok(readerScript.includes('while (t && t.tagName') || readerScript.includes("t.tagName !== 'A'"), 'reader intercepts link clicks through the bridge (no raw navigation)')
}

section('wiring: registration + guards')
const indexTs = readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf-8')
ok(indexTs.includes('reader: READER_HTML') && indexTs.includes('taskmgr: TASKMGR_HTML'), 'aether://reader + aether://taskmgr registered')
const ipcTs = readFileSync(path.join(ROOT, 'src/main/ipc.ts'), 'utf-8')
for (const ch of ['reader:get', 'reader:fetch', 'taskmgr:snapshot', 'taskmgr:kill', 'shots:take']) {
  ok(ipcTs.includes(`'${ch}'`), `IPC ${ch} registered`)
}
{
  for (const ch of ['reader:get', 'reader:fetch', 'taskmgr:snapshot', 'taskmgr:kill']) {
    const idx = ipcTs.indexOf(`'${ch}'`)
    const after = ipcTs.slice(idx, idx + 220)
    ok(/isInternal\(e\)/.test(after), `${ch} is aether://-only (isInternal guard)`)
  }
  const idx = ipcTs.indexOf(`'shots:take'`)
  ok(/guard\(e, 'shots:take'\)/.test(ipcTs.slice(idx, idx + 160)), 'shots:take guarded')
}
ok(ipcTs.includes('entry.tabs.listIds().includes(id)'), 'taskmgr:kill only closes REAL managed tab ids')

const menuTs = readFileSync(path.join(ROOT, 'src/main/menu.ts'), 'utf-8')
ok(menuTs.includes("'Reader View'") && menuTs.includes("accelerator: 'F9'"), 'Reader View on F9')
ok(menuTs.includes("'Take Screenshot'") && menuTs.includes("'CmdOrCtrl+Shift+S'"), 'screenshot on Ctrl+Shift+S')
ok(menuTs.includes("'Task Manager'") && menuTs.includes("'Shift+Escape'"), 'task manager on Shift+Esc')
ok(menuTs.includes("'Picture-in-Picture'"), 'PiP menu + context-menu entries')
ok(menuTs.includes('captureReaderArticle(wc)') && menuTs.includes("navigate(id, 'aether://reader')"), 'reader flow: capture then navigate SAME webContents')
ok(menuTs.includes('requestPictureInPicture'), 'PiP uses Chromium-native requestPictureInPicture')
ok(menuTs.includes("document.elementFromPoint"), 'context-menu PiP targets the video under the cursor')

const preload = readFileSync(path.join(ROOT, 'src/preload/api.ts'), 'utf-8')
ok(preload.includes('reader:') && preload.includes("'reader:get'") && preload.includes("'reader:fetch'"), 'preload reader bridge')
ok(preload.includes('taskmgr:') && preload.includes("'taskmgr:snapshot'") && preload.includes("'taskmgr:kill'"), 'preload taskmgr bridge')
ok(preload.includes('shots:') && preload.includes("'shots:take'"), 'preload shots bridge')

section('wiring: reader module hardening')
const readerTs = readFileSync(path.join(ROOT, 'src/main/reader.ts'), 'utf-8')
ok(readerTs.includes('DROP_TAGS') && readerTs.includes('KEEP_ATTRS'), 'sanitizer whitelist tables present')
ok(readerTs.includes("MAX_ARTICLE_CHARS = 220_000"), 'article HTML size cap')
ok(readerTs.includes("MAX_FETCH_BYTES = 3_000_000"), 'fetch size cap (3 MB)')
ok(readerTs.includes("if (!/^https?:/i.test(url)) throw new Error('Reader view works on web pages"), 'capture refuses non-web pages')
ok(readerTs.includes("u.protocol === 'https:' || u.protocol === 'http:'"), 'fetch URL scheme validated (http/https only)')
ok(readerTs.includes('store.set(wc.id, article)') && readerTs.includes('store.get(wcId)'), 'article store keyed by webContents id')
ok(readerTs.includes('AbortSignal.timeout(15_000)'), 'fetch has a hard timeout')

section('wiring: screenshot module')
const shotTs = readFileSync(path.join(ROOT, 'src/main/shot.ts'), 'utf-8')
ok(shotTs.includes("path.join(app.getPath('userData'), 'screenshots')"), 'screenshots live under userData')
ok(shotTs.includes('shotFilename()'), 'timestamped filename from shared/fmt')
ok(shotTs.includes('clipboard.write([item])'), 'Electron-45 W3C clipboard write')
ok(shotTs.includes('img.isEmpty()'), 'empty-capture guard')

console.log(`\n════════════════════════════════════`)
console.log(`  v2.5.0: ${pass} passed, ${fail} failed`)
console.log(`════════════════════════════════════`)
process.exit(fail ? 1 : 0)
