/**
 * Internal pages served over the aether:// protocol.
 * Kept as inline HTML strings so packaging needs zero static file handling.
 * NOTE: page scripts are plain ES5-ish and must NOT contain backticks or ${.
 */

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
  <div style="margin-top:34px; width:min(560px,86vw); position:relative;">
    <input id="q" type="text" placeholder="Search the web or type a URL"
      style="width:100%; padding:16px 20px; font-size:15px; color:#e8eaf0;
      background:#1e2026; border:1px solid #2e313a; border-radius:14px; outline:none;" />
    <div style="position:absolute; right:14px; top:50%; transform:translateY(-50%); color:#7c8cff; font-size:12px; letter-spacing:.08em;">AI</div>
  </div>
  <div style="margin-top:44px; width:min(640px,88vw);">
    <div style="color:#9aa0ae; font-size:12px; letter-spacing:.1em; margin-bottom:14px;">TOP SITES</div>
    <div id="top" style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px;"></div>
    <div style="color:#9aa0ae; font-size:12px; letter-spacing:.1em; margin:26px 0 14px;" id="bm-label">BOOKMARKS</div>
    <div id="bm" style="display:flex; flex-direction:column; gap:8px;"></div>
  </div>
  <div style="margin-top:auto; padding:18px; color:#565b66; font-size:11px;">
    Aether Browser 0.4.0 — local AI, open source
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
  var q = document.getElementById('q')
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && q.value.trim()) window.aether.internal.search(q.value.trim())
  })
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
  })
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
    <div id="answer" style="margin-top:14px; font-size:14.5px; line-height:1.65; white-space:pre-wrap;
      background:#1e2026; border:1px solid #2e313a; border-radius:14px; padding:20px; display:none;"></div>
    <div id="sources" style="margin-top:18px; display:none;"></div>
  </div>
  `,
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  function run(q) {
    if (!q) return
    document.getElementById('q').value = q
    var status = document.getElementById('status')
    var answer = document.getElementById('answer')
    var sources = document.getElementById('sources')
    status.textContent = 'Searching the web…'
    answer.style.display = 'none'
    sources.style.display = 'none'
    sources.innerHTML = ''
    answer.textContent = ''
    var req = window.aether.internal.ask(q)
    req.onData(function (d) {
      if (d.sources) {
        status.textContent = ''
        sources.style.display = 'block'
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
      if (d.delta) {
        answer.style.display = 'block'
        answer.textContent += d.delta
      }
      if (d.error) {
        status.textContent = d.error
      }
    })
    req.result.catch(function (e) { status.textContent = String(e.message || e) })
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

    <div class="hint" style="margin-top:26px">Aether 0.4.0 — everything is stored locally on this device.</div>
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
