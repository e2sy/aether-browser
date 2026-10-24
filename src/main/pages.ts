/**
 * Internal pages served over the aether:// protocol.
 * Kept as inline HTML strings so packaging needs zero static file handling.
 * NOTE: page scripts are plain ES5-ish and must NOT contain backticks or ${
 * (outside the template placeholders below).
 */
import { app } from 'electron'

/** Live version — no more hardcoded footer drift between releases. */
const VER = app.getVersion()

const BASE_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { height:100%; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, Ubuntu, 'Noto Sans', sans-serif;
    background:#16171b; color:#e8eaf0;
    display:flex; flex-direction:column; align-items:center;
    -webkit-user-select:none; user-select:none;
  }
  a { color:inherit; text-decoration:none; }
`

function pageShell(title: string, body: string, script: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:;">
<title>${title}</title>
<style>${BASE_CSS}</style>
</head>
<body>
${body}
<script>${script}</script>
</body>
</html>`
}

export const NEW_TAB_HTML = pageShell(
  'New Tab',
  `
  <div style="margin-top:12vh; font-size:52px; font-weight:200;" id="clock">--:--</div>
  <div style="margin-top:6px; color:#9aa0ae;" id="greeting"></div>
  <div id="bridge-error" style="display:none; margin-top:30px; width:min(560px,86vw); padding:12px 16px;
    background:#2a1c1c; border:1px solid #3a2a2a; border-radius:10px; color:#ff8a8a; font-size:13px;
    line-height:1.5; -webkit-user-select:text; user-select:text;"></div>
  <form id="searchform" style="margin-top:34px; width:min(560px,86vw); position:relative;">
    <input id="q" type="text" placeholder="Search the web or type a URL" autocomplete="off"
      style="width:100%; padding:16px 64px 16px 20px; font-size:15px; color:#e8eaf0;
      background:#1e2026; border:1px solid #2e313a; border-radius:14px; outline:none;" />
    <button id="aibtn" type="button" title="Search with Aether AI"
      style="position:absolute; right:10px; top:50%; transform:translateY(-50%); color:#7c8cff; font-size:12px;
      letter-spacing:.08em; background:#7c8cff1a; border:none; border-radius:8px; padding:6px 10px;
      cursor:pointer;">AI</button>
  </form>
  <div style="margin-top:44px; width:min(640px,88vw);">
    <div style="color:#9aa0ae; font-size:12px; letter-spacing:.1em; margin-bottom:14px;">TOP SITES</div>
    <div id="top" style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px;"></div>
    <div style="color:#9aa0ae; font-size:12px; letter-spacing:.1em; margin:26px 0 14px;" id="bm-label">BOOKMARKS</div>
    <div id="bm" style="display:flex; flex-direction:column; gap:8px;"></div>
  </div>
  <div style="margin-top:auto; padding:18px; color:#565b66; font-size:11px;">
    Aether Browser ${VER} — local AI, open source
  </div>
  `,
  `
  function el(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d }
  function site(a) {
    var card = el('a'); card.href = '#'
    card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 8px;background:#1e2026;border:1px solid #2e313a;border-radius:12px;overflow:hidden'
    var letter = document.createElement('div')
    var host = a.host || '?'
    letter.textContent = host.charAt(0).toUpperCase()
    letter.style.cssText = 'width:34px;height:34px;border-radius:50%;background:#7c8cff22;color:#7c8cff;display:flex;align-items:center;justify-content:center;font-weight:600'
    var label = document.createElement('div')
    label.textContent = host.replace(/^www\\./, '')
    label.style.cssText = 'font-size:11px;color:#c6cad4;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    card.appendChild(letter); card.appendChild(label)
    card.addEventListener('click', function (e) { e.preventDefault(); window.aether.internal.open(a.url) })
    return card
  }
  function bmRow(b) {
    var row = el('a'); row.href = '#'
    row.style.cssText = 'display:flex;gap:10px;align-items:center;padding:10px 14px;background:#1e2026;border:1px solid #2e313a;border-radius:10px'
    var t = document.createElement('div'); t.textContent = b.title || b.url
    t.style.cssText = 'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    var u = document.createElement('div'); u.textContent = (b.url || '').replace(/^https?:\\/\\//, '').split('/')[0]
    u.style.cssText = 'font-size:11px;color:#9aa0ae;flex:none'
    row.appendChild(t); row.appendChild(u)
    row.addEventListener('click', function (e) { e.preventDefault(); window.aether.internal.open(b.url) })
    return row
  }
  function clock() {
    var d = new Date()
    var h = d.getHours(), m = d.getMinutes()
    document.getElementById('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
    var g = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
    document.getElementById('greeting').textContent = g + ' — everything you do here stays on this device.'
  }
  clock(); setInterval(clock, 30000)
  function bridgeError(msg) {
    var b = document.getElementById('bridge-error')
    b.style.display = 'block'
    b.textContent = msg
  }
  function go(q) {
    if (!q) return
    try {
      window.aether.internal.search(q)
    } catch (e) {
      bridgeError('Browser bridge unavailable (' + (e && e.message) + ') — fully quit Aether and start it again. If it keeps happening, run: npm run build')
    }
  }
  var q = document.getElementById('q')
  document.getElementById('searchform').addEventListener('submit', function (e) {
    e.preventDefault()
    go(q.value.trim())
  })
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && q.value.trim()) { e.preventDefault(); go(q.value.trim()) }
  })
  document.getElementById('aibtn').addEventListener('click', function () {
    var query = q.value.trim()
    if (!query) return
    try {
      window.aether.internal.open('aether://search?q=' + encodeURIComponent(query))
    } catch (e) {
      bridgeError('Browser bridge unavailable (' + (e && e.message) + ') — fully quit Aether and start it again.')
    }
  })
  if (typeof window.aether === 'undefined') {
    bridgeError('UI bridge failed to load — keyboard and buttons cannot talk to the browser. Fully quit Aether (close every window) and start it again; if it keeps happening, run: npm run build')
  }
  try {
    window.aether.internal.startup().then(function (data) {
    var top = document.getElementById('top')
    if (!data.topSites.length) {
      top.innerHTML = ''
      var hint = el('div'); hint.textContent = 'Your most visited sites will appear here.'
      hint.style.cssText = 'grid-column:1/-1;color:#565b66;font-size:13px;padding:6px 2px'
      top.appendChild(hint)
    } else data.topSites.forEach(function (s) { top.appendChild(site(s)) })
    var bm = document.getElementById('bm')
    if (!data.bookmarks.length) {
      document.getElementById('bm-label').textContent = ''
    } else data.bookmarks.forEach(function (b) { bm.appendChild(bmRow(b)) })
    }).catch(function (e) {
      bridgeError('Could not load new-tab data: ' + (e && e.message ? e.message : e))
    })
  } catch (e) {
    bridgeError('Browser bridge unavailable (' + (e && e.message) + ') — fully quit Aether and start it again. If it keeps happening, run: npm run build')
  }
  `
)

export const SEARCH_HTML = pageShell(
  'Aether Search',
  `
  <div style="width:min(680px,90vw); margin-top:10vh;">
    <div style="display:flex; align-items:center; gap:12px;">
      <div style="font-size:22px; font-weight:700; letter-spacing:-0.02em;">
        aether<span style="color:#7c8cff">AI</span>
      </div>
      <input id="q" type="text" style="flex:1; padding:12px 18px; font-size:14px; color:#e8eaf0;
        background:#1e2026; border:1px solid #2e313a; border-radius:12px; outline:none;" />
      <button id="go" style="padding:12px 20px; font-size:13px; font-weight:600; color:#fff;
        background:#5b6cff; border:none; border-radius:12px; cursor:pointer;">Search</button>
    </div>
    <div id="status" style="margin-top:26px; color:#9aa0ae; font-size:13px;"></div>
    <div id="gfallback" style="margin-top:14px; display:none;"></div>
    <div id="answer" style="margin-top:14px; font-size:14.5px; line-height:1.65; white-space:pre-wrap;
      background:#1e2026; border:1px solid #2e313a; border-radius:14px; padding:20px; display:none;"></div>
    <div id="sources" style="margin-top:18px; display:none;"></div>
  </div>
  `,
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  var gotData = false
  function showGoogle(q, url) {
    var wrap = document.getElementById('gfallback')
    wrap.innerHTML = ''
    var btn = document.createElement('a')
    btn.href = '#'
    btn.style.cssText = 'display:inline-block;padding:10px 18px;font-size:13px;font-weight:600;color:#fff;background:#5b6cff;border-radius:10px;cursor:pointer;text-decoration:none'
    btn.textContent = 'Search on Google instead'
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      window.aether.internal.open(url || ('https://www.google.com/search?q=' + encodeURIComponent(q)))
    })
    wrap.appendChild(btn)
    wrap.style.display = 'block'
  }
  function setError(msg, q) {
    var status = document.getElementById('status')
    status.textContent = msg
    status.style.color = '#ff8a8a'
    showGoogle(q, '')
  }
  function run(q) {
    if (!q) return
    document.getElementById('q').value = q
    var status = document.getElementById('status')
    var answer = document.getElementById('answer')
    var sources = document.getElementById('sources')
    var gf = document.getElementById('gfallback')
    status.style.color = ''
    status.textContent = 'Searching the web…'
    answer.style.display = 'none'
    sources.style.display = 'none'
    sources.innerHTML = ''
    gf.style.display = 'none'
    gf.innerHTML = ''
    answer.textContent = ''
    gotData = false
    var watchdog = setTimeout(function () {
      if (!gotData) setError('The search engines did not respond in time. Try again, or use Google below.', q)
    }, 25000)
    var req = window.aether.internal.ask(q)
    req.onData(function (d) {
      gotData = true
      if (d.sources) {
        status.textContent = d.sources.length ? '' : 'No web results found for this query.'
        sources.style.display = d.sources.length ? 'block' : 'none'
        d.sources.forEach(function (r, i) {
          var card = document.createElement('a')
          card.href = '#'
          card.style.cssText = 'display:block;padding:12px 16px;margin-bottom:8px;background:#1a1c21;border:1px solid #2e313a;border-radius:10px'
          var t = esc('[' + (i + 1) + '] ' + r.title); t.style.cssText = 'font-size:13px;color:#aeb6ff;font-weight:600'
          var u = esc(r.url.replace(/^https?:\\/\\//, '').split('/')[0]); u.style.cssText = 'font-size:11px;color:#565b66;margin-top:3px'
          var s = esc(r.snippet); s.style.cssText = 'font-size:12px;color:#9aa0ae;margin-top:4px'
          card.appendChild(t); card.appendChild(u); card.appendChild(s)
          card.addEventListener('click', function (e) { e.preventDefault(); window.aether.internal.open(r.url) })
          sources.appendChild(card)
        })
      }
      if (d.googleFallback) showGoogle(q, d.googleFallback)
      if (d.delta) {
        answer.style.display = 'block'
        answer.textContent += d.delta
        if (status.textContent !== 'No web results found for this query.') status.textContent = ''
      }
      if (d.error) {
        status.textContent = d.error
        status.style.color = '#ff8a8a'
      }
      if (d.done) clearTimeout(watchdog)
    })
    req.result.then(function (r) {
      clearTimeout(watchdog)
      if (r && r.error && !gotData) setError(String(r.error), q)
    })
  }
  document.getElementById('go').addEventListener('click', function () { run(document.getElementById('q').value.trim()) })
  document.getElementById('q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') run(document.getElementById('q').value.trim())
  })
  var params = new URLSearchParams(location.search)
  run(params.get('q'))
  `
)

/* ------------------------------------------------------------------ */
/* Shared manager-page helpers (history / bookmarks / settings)        */
/* ------------------------------------------------------------------ */

const MGR_CSS = `
  .wrap { width:min(760px,92vw); margin-top:7vh; padding-bottom:60px; }
  .head { display:flex; align-items:center; gap:14px; margin-bottom:22px; }
  .head h1 { font-size:20px; font-weight:700; letter-spacing:-0.02em; margin-right:auto; }
  .head input { flex:none; width:280px; padding:10px 14px; font-size:13px; color:#e8eaf0;
    background:#1e2026; border:1px solid #2e313a; border-radius:10px; outline:none; }
  .head input:focus { border-color:#7c8cff; }
  .muted-btn { padding:9px 14px; font-size:12px; color:#ff8a8a; background:transparent;
    border:1px solid #3a2a2a; border-radius:10px; cursor:pointer; }
  .muted-btn:hover { background:#2a1c1c; }
  .rows { display:flex; flex-direction:column; gap:6px; }
  .row { display:flex; align-items:center; gap:12px; padding:11px 14px;
    background:#1a1c21; border:1px solid #2e313a; border-radius:10px; cursor:pointer; }
  .row:hover { border-color:#3d4150; }
  .row .ic { width:30px; height:30px; border-radius:8px; background:#7c8cff22; color:#7c8cff;
    display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; flex:none; }
  .row .meta { min-width:0; flex:1; }
  .row .t { font-size:13px; color:#e8eaf0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .u { font-size:11px; color:#7d828f; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
  .row .when { font-size:11px; color:#565b66; flex:none; }
  .row .del { flex:none; width:26px; height:26px; border:none; border-radius:7px; background:transparent;
    color:#565b66; font-size:14px; cursor:pointer; }
  .row .del:hover { background:#2a1c1c; color:#ff8a8a; }
  .empty2 { color:#565b66; font-size:13px; padding:30px 4px; text-align:center; }
  .none { border:none; background:transparent; color:#9aa0ae; cursor:default; }
`

function mgrShell(title: string, heading: string, withClear: boolean, body: string, script: string): string {
  const clearBtn = withClear ? '<button class="muted-btn" id="clear">Clear all</button>' : ''
  return pageShell(
    title,
    `
    <div class="wrap">
      <div class="head">
        <h1>${heading}</h1>
        <input id="q" type="text" placeholder="Search…" />
        ${clearBtn}
      </div>
      <div class="rows" id="rows"></div>
      <div class="empty2" id="empty" style="display:none">Nothing here yet.</div>
    </div>
    <style>${MGR_CSS}</style>
    `,
    script
  )
}

export const HISTORY_HTML = mgrShell(
  'History',
  'History',
  true,
  '',
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  function when(ts) {
    var d = new Date(ts), today = new Date()
    var hm = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes()
    if (d.toDateString() === today.toDateString()) return hm
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm
  }
  var current = []
  function render(items) {
    current = items
    var rows = document.getElementById('rows')
    rows.innerHTML = ''
    document.getElementById('empty').style.display = items.length ? 'none' : 'block'
    items.forEach(function (h) {
      var row = document.createElement('div'); row.className = 'row'
      var ic = document.createElement('div'); ic.className = 'ic none'
      ic.textContent = (h.host || '?').replace(/^www\\./, '').charAt(0).toUpperCase()
      var meta = document.createElement('div'); meta.className = 'meta'
      var t = esc(h.title || h.url); t.className = 't'
      var u = esc(h.url); u.className = 'u'
      meta.appendChild(t); meta.appendChild(u)
      var w = document.createElement('div'); w.className = 'when'; w.textContent = when(h.ts)
      var del = document.createElement('button'); del.className = 'del'; del.textContent = '\\u00d7'
      del.title = 'Remove from history'
      del.addEventListener('click', function (e) {
        e.stopPropagation()
        window.aether.history.remove(h.url)
        render(current.filter(function (x) { return x.url !== h.url }))
      })
      row.appendChild(ic); row.appendChild(meta); row.appendChild(w); row.appendChild(del)
      row.addEventListener('click', function () { window.aether.internal.open(h.url) })
      rows.appendChild(row)
    })
  }
  function load() { window.aether.history.search(document.getElementById('q').value).then(render) }
  document.getElementById('q').addEventListener('input', load)
  document.getElementById('clear').addEventListener('click', function () {
    if (confirm('Clear ALL browsing history?')) { window.aether.history.clear(); render([]) }
  })
  load()
  `
)

export const BOOKMARKS_HTML = mgrShell(
  'Bookmarks',
  'Bookmarks',
  false,
  '',
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  var current = []
  function render(items) {
    current = items
    var rows = document.getElementById('rows')
    rows.innerHTML = ''
    document.getElementById('empty').style.display = items.length ? 'none' : 'block'
    document.getElementById('empty').textContent = items.length ? '' : 'No bookmarks yet — use the star in the toolbar.'
    items.forEach(function (b) {
      var row = document.createElement('div'); row.className = 'row'
      var host = ''
      try { host = new URL(b.url).hostname } catch (err) { host = '?' }
      var ic = document.createElement('div'); ic.className = 'ic none'
      ic.textContent = host.replace(/^www\\./, '').charAt(0).toUpperCase()
      var meta = document.createElement('div'); meta.className = 'meta'
      var t = esc(b.title || b.url); t.className = 't'
      var u = esc(b.url); u.className = 'u'
      meta.appendChild(t); meta.appendChild(u)
      var del = document.createElement('button'); del.className = 'del'; del.textContent = '\\u00d7'
      del.title = 'Remove bookmark'
      del.addEventListener('click', function (e) {
        e.stopPropagation()
        window.aether.bookmarks.remove(b.url)
        render(current.filter(function (x) { return x.url !== b.url }))
      })
      row.appendChild(ic); row.appendChild(meta); row.appendChild(del)
      row.addEventListener('click', function () { window.aether.internal.open(b.url) })
      rows.appendChild(row)
    })
  }
  function load() { window.aether.bookmarks.search(document.getElementById('q').value).then(render) }
  document.getElementById('q').addEventListener('input', load)
  load()
  `
)

export const SETTINGS_HTML = pageShell(
  'Settings',
  `
  <div class="wrap" style="width:min(620px,92vw)">
    <div class="head"><h1>Settings</h1><span id="health" style="font-size:12px;color:#7d828f"></span></div>

    <div class="sec">
      <div class="label">Local model (Ollama)</div>
      <select id="model" style="width:100%"></select>
      <div class="hint">Installed models appear here automatically. To add more without the CLI, open the sidebar → <b>Models</b> (or press <span class="mono">Ctrl+Shift+M</span>) and pull any model from Ollama's library.</div>
    </div>

    <div class="sec">
      <div class="label">Address bar searches use</div>
      <div class="opts">
        <label><input type="radio" name="sm" value="ai" /> Aether AI search (private, cited)</label>
        <label><input type="radio" name="sm" value="google" /> Google</label>
        <label><input type="radio" name="sm" value="duckduckgo" /> DuckDuckGo</label>
      </div>
    </div>

    <div class="sec">
      <div class="label">Behavior</div>
      <div class="opts">
        <label><input type="checkbox" id="confirmAgentActions" /> Agent asks before every action</label>
        <label><input type="checkbox" id="usePageContext" /> Sidebar chat sees the current page</label>
        <label><input type="checkbox" id="pageMemory" /> Remember page conversations per site (local memory)</label>
        <label><input type="checkbox" id="adblock" /> Block ads &amp; trackers (EasyList + EasyPrivacy)</label>
        <label><input type="checkbox" id="stripElectronUA" /> Identify as regular Chrome (better Google / YouTube compatibility)</label>
      </div>
      <div class="hint" style="margin-top:10px">Tiered memory saver: idle background tabs are hibernated (muted, throttled — instant wake) after the delay, then fully unloaded after 3× that. Pinned and playing-audio tabs are never touched.</div>
      <div style="display:flex; align-items:center; gap:10px; margin-top:8px">
        <label style="font-size:13px; color:#e8eaf0">Hibernate idle tabs after</label>
        <select id="memorySaver" style="width:140px">
          <option value="0">Never</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
        </select>
      </div>
    </div>

    <div class="sec">
      <div class="label">Extensions</div>
      <div class="hint" style="margin-bottom:10px">Install a .crx / .zip package in one click, or load a folder containing a <span class="mono">manifest.json</span> (MV2/MV3 content scripts, popups and browser actions run via electron-chrome-extensions). Disabled extensions are remembered but not loaded.</div>
      <div id="exts" style="display:flex; flex-direction:column; gap:6px"></div>
      <div class="row-btns" style="margin-top:10px">
        <button class="save-btn" id="extAddFile">Install from .crx / .zip…</button>
        <button class="muted-btn" id="extAdd">Load unpacked…</button>
        <span id="extMsg" style="font-size:11.5px;color:#7d828f;align-self:center"></span>
      </div>
      <div id="extDrop" class="ext-drop">…or drop a <b>.crx</b> / <b>.zip</b> here</div>
    </div>

    <div class="sec">
      <div class="label">Site permissions</div>
      <div class="hint" style="margin-bottom:10px">Sites ask before using these. Your Allow / Block choices are remembered here.</div>
      <div id="perms" style="display:flex; flex-direction:column; gap:6px"></div>
      <div class="row-btns" style="margin-top:10px"><button class="muted-btn" id="clearPerms">Forget all site permissions</button></div>
    </div>

    <div class="sec">
      <div class="label">Cloud fallback (optional — chat &amp; AI search only)</div>
      <div class="hint" style="margin-bottom:10px">If Ollama is unreachable, chat and AI search can use any OpenAI-compatible endpoint (e.g. Groq or OpenRouter free tiers). The agent always stays local. Your key never leaves this device.</div>
      <div class="opts">
        <label><input type="checkbox" id="cfEnabled" /> Enable cloud fallback</label>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px">
        <input id="cfUrl" type="text" placeholder="https://api.groq.com/openai/v1" />
        <input id="cfModel" type="text" placeholder="Model, e.g. llama-3.3-70b-versatile" />
        <input id="cfKey" type="password" placeholder="API key (stored locally only)" />
        <div class="row-btns"><button class="save-btn" id="cfSave">Save cloud fallback</button><span id="cfSaved" style="font-size:11.5px;color:#4ade80;align-self:center"></span></div>
      </div>
    </div>

    <div class="sec">
      <div class="label">Data</div>
      <div class="opts row-btns">
        <button class="muted-btn" id="clearHistory">Clear browsing history</button>
        <button class="muted-btn" id="clearBookmarks">Remove all bookmarks</button>
        <button class="muted-btn" id="clearMemory">Clear page memory</button>
      </div>
    </div>

    <div class="hint" style="margin-top:26px">Aether ${VER} — everything is stored locally on this device.</div>
  </div>
  <style>
    .sec { margin-bottom:24px; }
    .label { font-size:12px; letter-spacing:.08em; color:#9aa0ae; margin-bottom:10px; }
    .opts { display:flex; flex-direction:column; gap:9px; }
    .opts label { font-size:13px; color:#e8eaf0; display:flex; align-items:center; gap:9px; cursor:pointer; }
    .opts input { accent-color:#5b6cff; width:14px; height:14px; }
    .row-btns { flex-direction:row; gap:10px; }
    .hint { font-size:11.5px; color:#7d828f; line-height:1.6; }
    .mono { font-family:monospace; color:#7c8cff; }
    select, #cfUrl, #cfModel, #cfKey { padding:10px 12px; font-size:13px; color:#e8eaf0; background:#1e2026;
      border:1px solid #2e313a; border-radius:10px; outline:none; width:100%; }
    #cfUrl:focus, #cfModel:focus, #cfKey:focus { border-color:#7c8cff; }
    .save-btn { padding:9px 14px; font-size:12px; color:#fff; background:#5b6cff;
      border:none; border-radius:10px; cursor:pointer; }
    .save-btn:hover { background:#6d7cff; }
    .perm-row { display:flex; align-items:center; gap:10px; padding:9px 12px;
      background:#1a1c21; border:1px solid #2e313a; border-radius:10px; font-size:12.5px; }
    .perm-row .host { color:#e8eaf0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .perm-row .what { color:#7d828f; flex:none; }
    .perm-row .badge { flex:none; font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; }
    .perm-row .badge.allow { color:#4ade80; background:#4ade8018; }
    .perm-row .badge.block { color:#ff6b6b; background:#ff6b6b18; }
    .perm-row .del { margin-left:auto; flex:none; width:24px; height:24px; border:none; border-radius:7px;
      background:transparent; color:#565b66; font-size:13px; cursor:pointer; }
    .perm-row .del:hover { background:#2a1c1c; color:#ff8a8a; }
    .ext-row { display:flex; align-items:center; gap:10px; padding:9px 12px;
      background:#1a1c21; border:1px solid #2e313a; border-radius:10px; font-size:12.5px; }
    .ext-row .name { color:#e8eaf0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ext-row .ver { color:#565b66; flex:none; }
    .ext-row .badge { flex:none; font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; }
    .ext-row .badge.on { color:#4ade80; background:#4ade8018; }
    .ext-row .badge.off { color:#9aa0ae; background:#9aa0ae18; }
    .ext-drop { margin-top:10px; padding:14px; text-align:center; font-size:12px; color:#7d828f;
      border:1.5px dashed #33363f; border-radius:10px; transition: border-color .15s, background .15s; }
    .ext-drop.over { border-color:#7c8cff; background:#7c8cff14; color:#aeb4ff; }
    .ext-row button { flex:none; width:24px; height:24px; border:none; border-radius:7px;
      background:transparent; color:#565b66; font-size:12px; cursor:pointer; }
    .ext-row button:hover { background:#23262d; color:#e8eaf0; }
  </style>
  `,
  `
  function load() {
    window.aether.settings.get().then(function (s) {
      document.getElementById('model').value = s.model || ''
      var radios = document.querySelectorAll('input[name=sm]')
      for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === s.searchMode
      document.getElementById('confirmAgentActions').checked = !!s.confirmAgentActions
      document.getElementById('usePageContext').checked = !!s.usePageContext
      document.getElementById('pageMemory').checked = s.pageMemory !== false
      document.getElementById('adblock').checked = !!s.adblock
      document.getElementById('stripElectronUA').checked = !!s.stripElectronUA
      document.getElementById('memorySaver').value = String(s.memorySaver || 0)
      var cf = s.cloudFallback || {}
      document.getElementById('cfEnabled').checked = !!cf.enabled
      document.getElementById('cfUrl').value = cf.baseUrl || ''
      document.getElementById('cfModel').value = cf.model || ''
      document.getElementById('cfKey').value = cf.apiKey || ''
    })
    window.aether.ai.health().then(function (h) {
      document.getElementById('health').textContent = h.ok ? '● Ollama connected' : '● Ollama not reachable'
      document.getElementById('health').style.color = h.ok ? '#4ade80' : '#ff6b6b'
    })
    window.aether.ai.models().then(function (m) {
      var sel = document.getElementById('model')
      sel.innerHTML = ''
      var models = m.models || []
      if (!models.length) {
        var o = document.createElement('option'); o.value = ''; o.textContent = '(no models installed yet)'
        sel.appendChild(o); return
      }
      models.forEach(function (name) {
        var o = document.createElement('option'); o.value = name; o.textContent = name
        sel.appendChild(o)
      })
      window.aether.settings.get().then(function (s) { sel.value = s.model || models[0] })
    })
    loadPerms()
    loadExts()
  }
  var PERM_LABELS = { media: 'camera & microphone', geolocation: 'your location', notifications: 'notifications', midi: 'MIDI devices', 'speaker-selection': 'audio output', 'display-capture': 'screen capture' }
  function loadPerms() {
    window.aether.perms.list().then(function (list) {
      var box = document.getElementById('perms')
      box.innerHTML = ''
      if (!list.length) {
        var none = document.createElement('div')
        none.textContent = 'No remembered permissions yet.'
        none.style.cssText = 'color:#565b66;font-size:12.5px;padding:2px 2px'
        box.appendChild(none); return
      }
      list.forEach(function (p) {
        var row = document.createElement('div'); row.className = 'perm-row'
        var host = document.createElement('span'); host.className = 'host'; host.textContent = p.origin
        var what = document.createElement('span'); what.className = 'what'; what.textContent = PERM_LABELS[p.permission] || p.permission
        var badge = document.createElement('span'); badge.className = 'badge ' + p.decision; badge.textContent = p.decision
        var del = document.createElement('button'); del.className = 'del'; del.textContent = '\u00d7'; del.title = 'Forget this decision'
        del.addEventListener('click', function () {
          window.aether.perms.revoke(p.origin, p.permission)
          loadPerms()
        })
        row.appendChild(host); row.appendChild(what); row.appendChild(badge); row.appendChild(del)
        box.appendChild(row)
      })
    })
  }
  function loadExts() {
    window.aether.extensions.list().then(function (list) {
      var box = document.getElementById('exts')
      box.innerHTML = ''
      if (!list.length) {
        var none = document.createElement('div')
        none.textContent = 'No extensions installed yet.'
        none.style.cssText = 'color:#565b66;font-size:12.5px;padding:2px 2px'
        box.appendChild(none); return
      }
      list.forEach(function (x) {
        var row = document.createElement('div'); row.className = 'ext-row'
        var name = document.createElement('span'); name.className = 'name'; name.textContent = x.name; name.title = x.path
        var ver = document.createElement('span'); ver.className = 'ver'; ver.textContent = x.version
        var badge = document.createElement('span'); badge.className = 'badge ' + (x.enabled ? 'on' : 'off'); badge.textContent = x.enabled ? 'enabled' : 'disabled'
        var tog = document.createElement('button'); tog.textContent = x.enabled ? '⏸' : '▶'; tog.title = x.enabled ? 'Disable' : 'Enable'
        tog.addEventListener('click', function () { window.aether.extensions.toggle(x.path).then(loadExts) })
        var del = document.createElement('button'); del.textContent = '\u00d7'; del.title = 'Remove (files stay on disk)'
        del.addEventListener('click', function () {
          if (confirm('Remove ' + x.name + '?')) window.aether.extensions.remove(x.path).then(loadExts)
        })
        row.appendChild(name); row.appendChild(ver); row.appendChild(badge); row.appendChild(tog); row.appendChild(del)
        box.appendChild(row)
      })
    })
  }
  document.getElementById('extAdd').addEventListener('click', function () {
    var msg = document.getElementById('extMsg')
    msg.style.color = '#7d828f'
    msg.textContent = 'Choose a folder with manifest.json…'
    window.aether.extensions.add().then(function (r) {
      if (r && r.info) { msg.textContent = 'Loaded ' + r.info.name + ' ✓' }
      else { msg.textContent = '' }
      loadExts()
    }).catch(function (err) {
      msg.style.color = '#ff6b6b'
      msg.textContent = String(err && err.message || err)
    })
  })
  document.getElementById('extAddFile').addEventListener('click', function () {
    var msg = document.getElementById('extMsg')
    msg.style.color = '#7d828f'
    msg.textContent = 'Pick a .crx or .zip package…'
    window.aether.extensions.installFile().then(function (r) {
      if (r && r.info) { msg.style.color = '#4ade80'; msg.textContent = 'Installed ' + r.info.name + ' ✓' }
      else { msg.textContent = '' }
      loadExts()
    }).catch(function (err) {
      msg.style.color = '#ff6b6b'
      msg.textContent = String(err && err.message || err)
    })
  })
  var drop = document.getElementById('extDrop')
  if (drop) {
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over') })
    drop.addEventListener('dragleave', function () { drop.classList.remove('over') })
    drop.addEventListener('drop', function (e) {
      e.preventDefault()
      drop.classList.remove('over')
      var msg = document.getElementById('extMsg')
      var files = Array.prototype.slice.call(e.dataTransfer.files).filter(function (f) { return /\.(crx|zip)$/i.test(f.name) })
      if (!files.length) { msg.style.color = '#ff6b6b'; msg.textContent = 'Drop a .crx or .zip file'; return }
      msg.style.color = '#7d828f'
      msg.textContent = 'Installing ' + files[0].name + '…'
      var next = function (i) {
        if (i >= files.length) { loadExts(); return }
        var path = window.aether.files.pathFor(files[i])
        window.aether.extensions.installPath(path).then(function (info) {
          msg.style.color = '#4ade80'
          msg.textContent = 'Installed ' + info.name + ' ✓'
          next(i + 1)
        }).catch(function (err) {
          msg.style.color = '#ff6b6b'
          msg.textContent = String(err && err.message || err)
          next(i + 1)
        })
      }
      next(0)
    })
  }
  function save(patch) { window.aether.settings.set(patch) }
  document.getElementById('model').addEventListener('change', function (e) { save({ model: e.target.value || null }) })
  var radios = document.querySelectorAll('input[name=sm]')
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function (e) { if (e.target.checked) save({ searchMode: e.target.value }) })
  }
  document.getElementById('confirmAgentActions').addEventListener('change', function (e) { save({ confirmAgentActions: e.target.checked }) })
  document.getElementById('usePageContext').addEventListener('change', function (e) { save({ usePageContext: e.target.checked }) })
  document.getElementById('pageMemory').addEventListener('change', function (e) { save({ pageMemory: e.target.checked }) })
  document.getElementById('adblock').addEventListener('change', function (e) { save({ adblock: e.target.checked }) })
  document.getElementById('stripElectronUA').addEventListener('change', function (e) { save({ stripElectronUA: e.target.checked }) })
  document.getElementById('memorySaver').addEventListener('change', function (e) { save({ memorySaver: Number(e.target.value) || 0 }) })
  document.getElementById('cfSave').addEventListener('click', function () {
    save({
      cloudFallback: {
        enabled: document.getElementById('cfEnabled').checked,
        baseUrl: document.getElementById('cfUrl').value.trim(),
        model: document.getElementById('cfModel').value.trim(),
        apiKey: document.getElementById('cfKey').value.trim()
      }
    })
    var ok = document.getElementById('cfSaved')
    ok.textContent = 'Saved ✓'
    setTimeout(function () { ok.textContent = '' }, 2500)
  })
  document.getElementById('clearHistory').addEventListener('click', function () {
    if (confirm('Clear ALL browsing history?')) window.aether.history.clear()
  })
  document.getElementById('clearBookmarks').addEventListener('click', function () {
    if (confirm('Remove ALL bookmarks?')) {
      window.aether.bookmarks.search('').then(function (list) {
        list.forEach(function (b) { window.aether.bookmarks.remove(b.url) })
      })
    }
  })
  document.getElementById('clearMemory').addEventListener('click', function () {
    if (confirm('Forget all remembered page conversations?')) window.aether.memory.clear()
  })
  document.getElementById('clearPerms').addEventListener('click', function () {
    if (confirm('Forget all remembered site permissions?')) window.aether.perms.clear().then(loadPerms)
  })
  load()
  `
)
