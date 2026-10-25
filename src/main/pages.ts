/**
 * Internal pages served over the aether:// protocol.
 * Kept as inline HTML strings so packaging needs zero static file handling.
 * NOTE: page scripts are plain ES5-ish and must NOT contain backticks or ${
 * (outside the template placeholders below).
 */
import { app, nativeTheme } from 'electron'
import { appearanceCss } from './appearance'
import { mergedSettings } from './store'

/** Live version — no more hardcoded footer drift between releases. */
const VER = app.getVersion()

const BASE_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { height:100%; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, Ubuntu, 'Noto Sans', sans-serif;
    background:var(--ax-bg); color:var(--ax-fg);
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
<style>${appearanceCss(mergedSettings().appearance, nativeTheme.shouldUseDarkColors)}</style>
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
  <style>body { background: var(--ax-ntbg, var(--ax-bg)); }</style>
  <div style="margin-top:12vh; font-size:52px; font-weight:200;" id="clock">--:--</div>
  <div style="margin-top:6px; color:var(--ax-muted);" id="greeting"></div>
  <div id="bridge-error" style="display:none; margin-top:30px; width:min(560px,86vw); padding:12px 16px;
    background:var(--ax-danger-bg); border:1px solid var(--ax-danger-border); border-radius:10px; color:var(--ax-danger); font-size:13px;
    line-height:1.5; -webkit-user-select:text; user-select:text;"></div>
  <form id="searchform" style="margin-top:34px; width:min(560px,86vw); position:relative;">
    <input id="q" type="text" placeholder="Search the web or type a URL" autocomplete="off"
      style="width:100%; padding:16px 64px 16px 20px; font-size:15px; color:var(--ax-fg);
      background:var(--ax-card); border:1px solid var(--ax-border); border-radius:14px; outline:none;" />
    <button id="aibtn" type="button" title="Search with Aether AI"
      style="position:absolute; right:10px; top:50%; transform:translateY(-50%); color:var(--ax-accent); font-size:12px;
      letter-spacing:.08em; background:var(--ax-accent-soft); border:none; border-radius:8px; padding:6px 10px;
      cursor:pointer;">AI</button>
  </form>
  <div style="margin-top:44px; width:min(640px,88vw);">
    <div style="color:var(--ax-muted); font-size:12px; letter-spacing:.1em; margin-bottom:14px;">TOP SITES</div>
    <div id="top" style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px;"></div>
    <div style="color:var(--ax-muted); font-size:12px; letter-spacing:.1em; margin:26px 0 14px;" id="bm-label">BOOKMARKS</div>
    <div id="bm" style="display:flex; flex-direction:column; gap:8px;"></div>
  </div>
  <div style="margin-top:auto; padding:18px; color:var(--ax-faint); font-size:11px;">
    Aether Browser ${VER} — local AI, open source
  </div>
  `,
  `
  function el(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d }
  function site(a) {
    var card = el('a'); card.href = '#'
    card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 8px;background:var(--ax-card);border:1px solid var(--ax-border);border-radius:12px;overflow:hidden'
    var letter = document.createElement('div')
    var host = a.host || '?'
    letter.textContent = host.charAt(0).toUpperCase()
    letter.style.cssText = 'width:34px;height:34px;border-radius:50%;background:var(--ax-accent-soft);color:var(--ax-accent);display:flex;align-items:center;justify-content:center;font-weight:600'
    var label = document.createElement('div')
    label.textContent = host.replace(/^www\\./, '')
    label.style.cssText = 'font-size:11px;color:var(--ax-fg);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    card.appendChild(letter); card.appendChild(label)
    card.addEventListener('click', function (e) { e.preventDefault(); window.aether.internal.open(a.url) })
    return card
  }
  function bmRow(b) {
    var row = el('a'); row.href = '#'
    row.style.cssText = 'display:flex;gap:10px;align-items:center;padding:10px 14px;background:var(--ax-card);border:1px solid var(--ax-border);border-radius:10px'
    var t = document.createElement('div'); t.textContent = b.title || b.url
    t.style.cssText = 'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    var u = document.createElement('div'); u.textContent = (b.url || '').replace(/^https?:\\/\\//, '').split('/')[0]
    u.style.cssText = 'font-size:11px;color:var(--ax-muted);flex:none'
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
  try {
    window.aether.settings.get().then(function (s) {
      if (s.appearance && s.appearance.newtabClock === false) {
        document.getElementById('clock').style.display = 'none'
        document.getElementById('greeting').style.display = 'none'
      }
    }).catch(function () {})
  } catch (e) {}
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
      hint.style.cssText = 'grid-column:1/-1;color:var(--ax-faint);font-size:13px;padding:6px 2px'
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
  <div style="width:min(680px,90vw); margin-top:7vh;">
    <div style="display:flex; align-items:baseline; gap:10px;">
      <div style="font-size:24px; font-weight:700; letter-spacing:-0.02em;">
        aether<span style="color:var(--ax-accent)">Search</span>
      </div>
      <div style="font-size:11.5px; color:var(--ax-muted2);">the open metasearch — every result says where it came from</div>
    </div>
    <div style="display:flex; align-items:center; gap:12px; margin-top:16px;">
      <input id="q" type="text" style="flex:1; padding:13px 18px; font-size:14px; color:var(--ax-fg);
        background:var(--ax-card); border:1px solid var(--ax-border); border-radius:12px; outline:none;" />
      <button id="go" style="padding:13px 20px; font-size:13px; font-weight:600; color:#fff;
        background:var(--ax-accent2); border:none; border-radius:12px; cursor:pointer;">Search</button>
    </div>

    <div id="instant" style="margin-top:18px; display:none; background:linear-gradient(135deg,var(--ax-accent-soft),var(--ax-accent)05);
      border:1px solid var(--ax-border-hi); border-radius:14px; padding:16px 20px;">
      <div id="instant-out" style="font-size:26px; font-weight:600; color:var(--ax-accent-tint); letter-spacing:-0.01em;"></div>
      <div style="margin-top:5px; font-size:11px; color:var(--ax-muted2);">Aether instant answer — computed on this device, no network</div>
    </div>

    <div id="status" style="margin-top:20px; color:var(--ax-muted); font-size:13px;"></div>
    <div id="chips" style="margin-top:10px; display:none; flex-wrap:wrap; gap:6px;"></div>
    <div id="gfallback" style="margin-top:14px; display:none;"></div>
    <div id="aiwrap" style="margin-top:18px; display:none; background:var(--ax-card); border:1px solid var(--ax-border);
      border-radius:14px; padding:18px 20px;">
      <div style="font-size:11px; letter-spacing:.09em; color:var(--ax-accent); margin-bottom:9px;">AI ANSWER — LOCAL MODEL</div>
      <div id="answer" style="font-size:14px; line-height:1.65; white-space:pre-wrap;"></div>
    </div>
    <div id="sources" style="margin-top:18px; display:none;"></div>
    <div style="margin-top:34px; padding-bottom:26px; color:var(--ax-faint); font-size:11px; line-height:1.7;">
      Aether Search aggregates public sources, strips tracking parameters, deduplicates and ranks
      results locally. It does not profile you and stores nothing beyond this device's history.
    </div>
  </div>
  `,
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  function host(u) { return String(u || '').replace(/^https?:\\/\\//, '').split('/')[0] }
  var gotData = false
  function showGoogle(q, url) {
    var wrap = document.getElementById('gfallback')
    wrap.innerHTML = ''
    var btn = document.createElement('a')
    btn.href = '#'
    btn.style.cssText = 'display:inline-block;padding:10px 18px;font-size:13px;font-weight:600;color:#fff;background:var(--ax-accent2);border-radius:10px;cursor:pointer;text-decoration:none'
    btn.textContent = 'Search on Google instead'
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      window.aether.internal.open(url || ('https://www.google.com/search?q=' + encodeURIComponent(q)))
    })
    wrap.appendChild(btn)
    wrap.style.display = 'block'
  }
  function renderInstant(q) {
    var card = document.getElementById('instant')
    if (!window.aether || !window.aether.internal || !window.aether.internal.instant) return
    window.aether.internal.instant(q).then(function (a) {
      if (a && a.output) {
        document.getElementById('instant-out').textContent = a.input + ' = ' + a.output
        card.style.display = 'block'
      } else {
        card.style.display = 'none'
      }
    }).catch(function () {})
  }
  function renderChips(stats) {
    var chips = document.getElementById('chips')
    chips.innerHTML = ''
    if (!stats || !stats.length) { chips.style.display = 'none'; return }
    for (var i = 0; i < stats.length; i++) {
      var s = stats[i]
      var chip = document.createElement('span')
      chip.style.cssText = 'font-size:10.5px;padding:3px 9px;border-radius:20px;border:1px solid var(--ax-border);color:' + (s.error || !s.count ? 'var(--ax-faint)' : 'var(--ax-muted)') + ';background:var(--ax-card2)'
      chip.textContent = s.error ? (s.source + ' — unavailable') : (s.source + ' · ' + s.count + ' results · ' + s.ms + ' ms')
      chips.appendChild(chip)
    }
    chips.style.display = 'flex'
  }
  function renderSources(sources) {
    var box = document.getElementById('sources')
    box.innerHTML = ''
    if (!sources || !sources.length) { box.style.display = 'none'; return }
    for (var i = 0; i < sources.length; i++) {
      var r = sources[i]
      var card = document.createElement('a')
      card.href = '#'
      card.style.cssText = 'display:block;padding:12px 16px;margin-bottom:8px;background:var(--ax-card2);border:1px solid var(--ax-border);border-radius:10px'
      var t = esc((i + 1) + '. ' + r.title); t.style.cssText = 'font-size:13px;color:var(--ax-accent-tint);font-weight:600'
      var meta = document.createElement('div')
      meta.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:3px'
      var u = esc(host(r.url)); u.style.cssText = 'font-size:11px;color:var(--ax-faint)'
      meta.appendChild(u)
      if (r.source) {
        var badge = document.createElement('span')
        badge.style.cssText = 'font-size:9.5px;letter-spacing:.06em;padding:1px 7px;border-radius:20px;background:var(--ax-accent-soft);color:var(--ax-accent);font-weight:600'
        badge.textContent = String(r.source).toUpperCase()
        meta.appendChild(badge)
      }
      var s = esc(r.snippet); s.style.cssText = 'font-size:12px;color:var(--ax-muted);margin-top:4px'
      card.appendChild(t); card.appendChild(meta); card.appendChild(s)
      card.addEventListener('click', function (url) {
        return function (e) { e.preventDefault(); window.aether.internal.open(url) }
      }(r.url))
      box.appendChild(card)
    }
    box.style.display = 'block'
  }
  function run(q) {
    if (!q) return
    document.getElementById('q').value = q
    var status = document.getElementById('status')
    var aiwrap = document.getElementById('aiwrap')
    var answer = document.getElementById('answer')
    var sources = document.getElementById('sources')
    var gf = document.getElementById('gfallback')
    status.style.color = ''
    status.textContent = 'Searching the web — running all sources in parallel…'
    aiwrap.style.display = 'none'
    answer.textContent = ''
    sources.style.display = 'none'
    sources.innerHTML = ''
    gf.style.display = 'none'
    gf.innerHTML = ''
    document.getElementById('instant').style.display = 'none'
    document.getElementById('chips').style.display = 'none'
    gotData = false
    renderInstant(q)
    var watchdog = setTimeout(function () {
      if (!gotData) {
        status.textContent = 'The sources did not respond in time. Try again, or use Google below.'
        status.style.color = 'var(--ax-danger)'
        showGoogle(q, '')
      }
    }, 25000)
    var req = window.aether.internal.ask(q)
    req.onData(function (d) {
      gotData = true
      if (d.stats) renderChips(d.stats)
      if (d.sources) {
        renderSources(d.sources)
        if (d.sources.length) {
          status.textContent = ''
        } else if (!d.error) {
          status.textContent = 'No web results found for this query.'
        }
      }
      if (d.googleFallback) showGoogle(q, d.googleFallback)
      if (d.delta) {
        aiwrap.style.display = 'block'
        answer.textContent += d.delta
        if (status.style.color !== 'var(--ax-danger)') status.textContent = ''
      }
      if (d.error) {
        status.textContent = d.error
        status.style.color = 'var(--ax-danger)'
      }
      if (d.done) clearTimeout(watchdog)
    })
    req.result.then(function (r) {
      clearTimeout(watchdog)
      if (r && r.error && !gotData) {
        status.textContent = String(r.error)
        status.style.color = 'var(--ax-danger)'
        showGoogle(q, '')
      }
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
  .head input { flex:none; width:280px; padding:10px 14px; font-size:13px; color:var(--ax-fg);
    background:var(--ax-card); border:1px solid var(--ax-border); border-radius:10px; outline:none; }
  .head input:focus { border-color:var(--ax-accent); }
  .muted-btn { padding:9px 14px; font-size:12px; color:var(--ax-danger); background:transparent;
    border:1px solid var(--ax-danger-border); border-radius:10px; cursor:pointer; }
  .muted-btn:hover { background:var(--ax-danger-bg); }
  .rows { display:flex; flex-direction:column; gap:6px; }
  .row { display:flex; align-items:center; gap:12px; padding:11px 14px;
    background:var(--ax-card2); border:1px solid var(--ax-border); border-radius:10px; cursor:pointer; }
  .row:hover { border-color:var(--ax-border-hi); }
  .row .ic { width:30px; height:30px; border-radius:8px; background:var(--ax-accent-soft); color:var(--ax-accent);
    display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; flex:none; }
  .row .meta { min-width:0; flex:1; }
  .row .t { font-size:13px; color:var(--ax-fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .u { font-size:11px; color:var(--ax-muted2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
  .row .when { font-size:11px; color:var(--ax-faint); flex:none; }
  .row .del { flex:none; width:26px; height:26px; border:none; border-radius:7px; background:transparent;
    color:var(--ax-faint); font-size:14px; cursor:pointer; }
  .row .del:hover { background:var(--ax-danger-bg); color:var(--ax-danger); }
  .empty2 { color:var(--ax-faint); font-size:13px; padding:30px 4px; text-align:center; }
  .none { border:none; background:transparent; color:var(--ax-muted); cursor:default; }
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
    <div class="head"><h1>Settings</h1><span id="health" style="font-size:12px;color:var(--ax-muted2)"></span></div>

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

    <div class="sec" id="cust-sec">
      <div class="label">Customization — make it yours</div>
      <div class="opts">
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <label style="margin:0"><input type="radio" name="axtheme" value="dark" /> Dark</label>
          <label style="margin:0"><input type="radio" name="axtheme" value="light" /> Light</label>
          <label style="margin:0"><input type="radio" name="axtheme" value="system" /> Match system</label>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="axswatches"></div>
        <div style="display:flex;gap:10px;align-items:center">
          <label style="font-size:13px; color:var(--ax-fg)">Custom accent</label>
          <input type="color" id="axaccent" value="#7c8cff" style="width:46px; height:30px; padding:0; border:1px solid var(--ax-border); background:var(--ax-card); border-radius:8px; cursor:pointer" />
          <span id="axaccentVal" class="mono" style="font-size:11.5px"></span>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <label style="font-size:13px; color:var(--ax-fg)">Text &amp; UI size</label>
          <input type="range" id="axscale" min="85" max="125" step="5" style="width:180px" />
          <span id="axscaleVal" class="mono" style="font-size:11.5px"></span>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <label style="font-size:13px; color:var(--ax-fg)">New tab background</label>
          <select id="axntbg" style="width:160px">
            <option value="aurora">Aurora glow</option>
            <option value="midnight">Midnight</option>
            <option value="slate">Slate</option>
            <option value="light">Daylight</option>
            <option value="solid">Plain</option>
          </select>
        </div>
        <label><input type="checkbox" id="axclock" /> Show clock &amp; greeting on the new tab</label>
      </div>
      <div class="row-btns" style="margin-top:10px">
        <button class="muted-btn" id="axreset">Restore default look</button>
        <span id="axsaved" style="font-size:11.5px; color:var(--ax-ok); align-self:center"></span>
      </div>
      <div class="hint" style="margin-top:8px">Accent and size apply to every internal page and the browser chrome immediately. Theme changes re-render internal pages on open (this page reloads once so you see it live). "Match system" follows your OS light/dark setting.</div>
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
        <label style="font-size:13px; color:var(--ax-fg)">Hibernate idle tabs after</label>
        <select id="memorySaver" style="width:140px">
          <option value="0">Never</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
        </select>
      </div>
      <div class="label" style="margin-top:18px">Shields — blocking strength</div>
      <div class="opts">
        <label><input type="checkbox" id="shieldsAggressive" /> Aggressive mode — also inject anti-adblock scriptlets (stronger, but can break heavy sites like YouTube; use the toolbar shields popup to turn shields off per site)</label>
      </div>
      <div class="label" style="margin-top:14px">Shields — filter lists</div>
      <div class="opts" id="shieldPresets">
        <label style="display:none"><input type="checkbox" class="shield-preset" value="" /> placeholder</label>
      </div>
      <div class="hint" style="margin-top:8px">Extra filter lists on top of the built-in EasyList + EasyPrivacy engine (fetched fresh at boot, cached for offline). Cosmetic rules (hiding ad placeholders) and scriptlets from these lists apply too.</div>
      <div style="display:flex; gap:8px; margin-top:10px">
        <input id="listUrl" type="url" placeholder="https://example.com/my-filters.txt" style="flex:1" />
        <button id="listAdd" class="btn">Add list</button>
      </div>
      <div id="listStatus" class="hint" style="margin-top:6px"></div>
      <div id="listTable" style="margin-top:8px"></div>
    </div>

    <div class="sec">
      <div class="label">Extensions</div>
      <div class="hint" style="margin-bottom:10px">Install a .crx / .zip package in one click, or load a folder containing a <span class="mono">manifest.json</span> (MV2/MV3 content scripts, popups and browser actions run via electron-chrome-extensions). Disabled extensions are remembered but not loaded.</div>
      <div id="exts" style="display:flex; flex-direction:column; gap:6px"></div>
      <div class="row-btns" style="margin-top:10px">
        <button class="save-btn" id="extAddFile">Install from .crx / .zip…</button>
        <button class="muted-btn" id="extAdd">Load unpacked…</button>
        <span id="extMsg" style="font-size:11.5px;color:var(--ax-muted2);align-self:center"></span>
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
        <div class="row-btns"><button class="save-btn" id="cfSave">Save cloud fallback</button><span id="cfSaved" style="font-size:11.5px;color:var(--ax-ok);align-self:center"></span></div>
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
    .label { font-size:12px; letter-spacing:.08em; color:var(--ax-muted); margin-bottom:10px; }
    .opts { display:flex; flex-direction:column; gap:9px; }
    .opts label { font-size:13px; color:var(--ax-fg); display:flex; align-items:center; gap:9px; cursor:pointer; }
    .opts input { accent-color:var(--ax-accent2); width:14px; height:14px; }
    .row-btns { flex-direction:row; gap:10px; }
    .hint { font-size:11.5px; color:var(--ax-muted2); line-height:1.6; }
    .mono { font-family:monospace; color:var(--ax-accent); }
    select, #cfUrl, #cfModel, #cfKey { padding:10px 12px; font-size:13px; color:var(--ax-fg); background:var(--ax-card);
      border:1px solid var(--ax-border); border-radius:10px; outline:none; width:100%; }
    #cfUrl:focus, #cfModel:focus, #cfKey:focus { border-color:var(--ax-accent); }
    .save-btn { padding:9px 14px; font-size:12px; color:#fff; background:var(--ax-accent2);
      border:none; border-radius:10px; cursor:pointer; }
    .save-btn:hover { background:var(--ax-accent2); }
    .perm-row { display:flex; align-items:center; gap:10px; padding:9px 12px;
      background:var(--ax-card2); border:1px solid var(--ax-border); border-radius:10px; font-size:12.5px; }
    .perm-row .host { color:var(--ax-fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .perm-row .what { color:var(--ax-muted2); flex:none; }
    .perm-row .badge { flex:none; font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; }
    .perm-row .badge.allow { color:var(--ax-ok); background:var(--ax-ok-soft); }
    .perm-row .badge.block { color:var(--ax-danger); background:var(--ax-danger-soft); }
    .perm-row .del { margin-left:auto; flex:none; width:24px; height:24px; border:none; border-radius:7px;
      background:transparent; color:var(--ax-faint); font-size:13px; cursor:pointer; }
    .perm-row .del:hover { background:var(--ax-danger-bg); color:var(--ax-danger); }
    .ext-row { display:flex; align-items:center; gap:10px; padding:9px 12px;
      background:var(--ax-card2); border:1px solid var(--ax-border); border-radius:10px; font-size:12.5px; }
    .ext-row .name { color:var(--ax-fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ext-row .ver { color:var(--ax-faint); flex:none; }
    .ext-row .badge { flex:none; font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; }
    .ext-row .badge.on { color:var(--ax-ok); background:var(--ax-ok-soft); }
    .ext-row .badge.off { color:var(--ax-muted); background:var(--ax-muted-soft); }
    .ext-drop { margin-top:10px; padding:14px; text-align:center; font-size:12px; color:var(--ax-muted2);
      border:1.5px dashed var(--ax-border); border-radius:10px; transition: border-color .15s, background .15s; }
    .ext-drop.over { border-color:var(--ax-accent); background:var(--ax-accent-soft); color:var(--ax-accent-tint); }
    .ext-row button { flex:none; width:24px; height:24px; border:none; border-radius:7px;
      background:transparent; color:var(--ax-faint); font-size:12px; cursor:pointer; }
    .ext-row button:hover { background:var(--ax-border); color:var(--ax-fg); }
  </style>
  `,
  `
  function load() {
    window.aether.settings.get().then(function (s) {
      document.getElementById('model').value = s.model || ''
      var radios = document.querySelectorAll('input[name=sm]')
      for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === s.searchMode
      var a = s.appearance || {}
      axState = { theme: a.theme || 'dark', accent: a.accent || '#7c8cff', fontScale: a.fontScale || 1, newtabBg: a.newtabBg || 'aurora', newtabClock: a.newtabClock !== false }
      var axr = document.querySelectorAll('input[name=axtheme]')
      for (var j = 0; j < axr.length; j++) axr[j].checked = axr[j].value === axState.theme
      document.getElementById('axaccent').value = axState.accent
      document.getElementById('axaccentVal').textContent = axState.accent
      document.getElementById('axscale').value = Math.round(axState.fontScale * 100)
      document.getElementById('axscaleVal').textContent = Math.round(axState.fontScale * 100) + '%'
      document.getElementById('axntbg').value = axState.newtabBg
      document.getElementById('axclock').checked = axState.newtabClock
      axWire(); axMarkSwatch()
      document.getElementById('confirmAgentActions').checked = !!s.confirmAgentActions
      document.getElementById('usePageContext').checked = !!s.usePageContext
      document.getElementById('pageMemory').checked = s.pageMemory !== false
      document.getElementById('adblock').checked = !!s.adblock
      document.getElementById('shieldsAggressive').checked = !!s.shieldsAggressive
      document.getElementById('stripElectronUA').checked = !!s.stripElectronUA
      document.getElementById('memorySaver').value = String(s.memorySaver || 0)
      renderShieldPresets(s)
      renderShieldLists()
      var cf = s.cloudFallback || {}
      document.getElementById('cfEnabled').checked = !!cf.enabled
      document.getElementById('cfUrl').value = cf.baseUrl || ''
      document.getElementById('cfModel').value = cf.model || ''
      document.getElementById('cfKey').value = cf.apiKey || ''
    })
    window.aether.ai.health().then(function (h) {
      document.getElementById('health').textContent = h.ok ? '● Ollama connected' : '● Ollama not reachable'
      document.getElementById('health').style.color = h.ok ? 'var(--ax-ok)' : 'var(--ax-danger)'
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
        none.style.cssText = 'color:var(--ax-faint);font-size:12.5px;padding:2px 2px'
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
        none.style.cssText = 'color:var(--ax-faint);font-size:12.5px;padding:2px 2px'
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
    msg.style.color = 'var(--ax-muted2)'
    msg.textContent = 'Choose a folder with manifest.json…'
    window.aether.extensions.add().then(function (r) {
      if (r && r.info) { msg.textContent = 'Loaded ' + r.info.name + ' ✓' }
      else { msg.textContent = '' }
      loadExts()
    }).catch(function (err) {
      msg.style.color = 'var(--ax-danger)'
      msg.textContent = String(err && err.message || err)
    })
  })
  document.getElementById('extAddFile').addEventListener('click', function () {
    var msg = document.getElementById('extMsg')
    msg.style.color = 'var(--ax-muted2)'
    msg.textContent = 'Pick a .crx or .zip package…'
    window.aether.extensions.installFile().then(function (r) {
      if (r && r.info) { msg.style.color = 'var(--ax-ok)'; msg.textContent = 'Installed ' + r.info.name + ' ✓' }
      else { msg.textContent = '' }
      loadExts()
    }).catch(function (err) {
      msg.style.color = 'var(--ax-danger)'
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
      if (!files.length) { msg.style.color = 'var(--ax-danger)'; msg.textContent = 'Drop a .crx or .zip file'; return }
      msg.style.color = 'var(--ax-muted2)'
      msg.textContent = 'Installing ' + files[0].name + '…'
      var next = function (i) {
        if (i >= files.length) { loadExts(); return }
        var path = window.aether.files.pathFor(files[i])
        window.aether.extensions.installPath(path).then(function (info) {
          msg.style.color = 'var(--ax-ok)'
          msg.textContent = 'Installed ' + info.name + ' ✓'
          next(i + 1)
        }).catch(function (err) {
          msg.style.color = 'var(--ax-danger)'
          msg.textContent = String(err && err.message || err)
          next(i + 1)
        })
      }
      next(0)
    })
  }
  function save(patch) { window.aether.settings.set(patch) }

  /* ---------------- v1.4.0 Customization Studio ---------------- */
  var AX_PRESETS = ['#7c8cff', '#4f9cf9', '#3fb27f', '#e0a63a', '#e5636f', '#b06ce6', '#2fb8c6', '#f07ab8']
  var axState = { theme: 'dark', accent: '#7c8cff', fontScale: 1, newtabBg: 'aurora', newtabClock: true }
  function axShade(hex, amt) {
    var n = function (i) { return parseInt(hex.slice(i, i + 2), 16) }
    var mix = function (v) { var o = Math.max(0, Math.min(255, Math.round(v * (1 - amt)))); return ('0' + o.toString(16)).slice(-2) }
    return '#' + mix(n(1)) + mix(n(3)) + mix(n(5))
  }
  function axLive(a) {
    var r = document.documentElement.style
    r.setProperty('--ax-accent', a.accent)
    r.setProperty('--ax-accent2', axShade(a.accent, 0.16))
    r.setProperty('--ax-accent-tint', axShade(a.accent, 0.45))
    r.setProperty('--ax-accent-soft', axShade(a.accent, 0.86) + '22')
    document.body.style.zoom = a.fontScale
  }
  function axApply(patch, reloadAfter) {
    var next = {}
    for (var k in axState) next[k] = axState[k]
    for (var k2 in patch) next[k2] = patch[k2]
    save({ appearance: next })
    axState = next
    axLive(next)
    var flash = document.getElementById('axsaved')
    flash.textContent = 'Saved'
    setTimeout(function () { flash.textContent = '' }, 1400)
    if (reloadAfter) setTimeout(function () { location.reload() }, 350)
  }
  function axBuildSwatches() {
    var box = document.getElementById('axswatches')
    for (var i = 0; i < AX_PRESETS.length; i++) {
      (function (color) {
        var b = document.createElement('button')
        b.type = 'button'
        b.title = color
        b.style.cssText = 'width:26px;height:26px;border-radius:50%;border:2px solid ' + (color.toLowerCase() === axState.accent ? 'var(--ax-fg)' : 'transparent') + ';cursor:pointer;background:' + color
        b.addEventListener('click', function () { axApply({ accent: color }, false); axMarkSwatch() })
        box.appendChild(b)
      })(AX_PRESETS[i])
    }
  }
  function axMarkSwatch() {
    var box = document.getElementById('axswatches')
    var kids = box.children
    for (var i = 0; i < kids.length; i++) {
      kids[i].style.border = AX_PRESETS[i].toLowerCase() === axState.accent ? '2px solid var(--ax-fg)' : '2px solid transparent'
    }
  }
  function axWire() {
    var themes = document.querySelectorAll('input[name=axtheme]')
    for (var i = 0; i < themes.length; i++) {
      themes[i].addEventListener('change', function (e) {
        if (e.target.checked) axApply({ theme: e.target.value }, true)
      })
    }
    axBuildSwatches()
    document.getElementById('axaccent').addEventListener('input', function (e) {
      document.getElementById('axaccentVal').textContent = e.target.value
      axApply({ accent: e.target.value }, false)
      axMarkSwatch()
    })
    document.getElementById('axscale').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10) / 100
      document.getElementById('axscaleVal').textContent = Math.round(v * 100) + '%'
      axApply({ fontScale: v }, false)
    })
    document.getElementById('axntbg').addEventListener('change', function (e) {
      axApply({ newtabBg: e.target.value }, true)
    })
    document.getElementById('axclock').addEventListener('change', function (e) {
      axApply({ newtabClock: e.target.checked }, false)
    })
    document.getElementById('axreset').addEventListener('click', function () {
      save({ appearance: {} })
      setTimeout(function () { location.reload() }, 300)
    })
  }
  document.getElementById('model').addEventListener('change', function (e) { save({ model: e.target.value || null }) })
  var radios = document.querySelectorAll('input[name=sm]')
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function (e) { if (e.target.checked) save({ searchMode: e.target.value }) })
  }
  document.getElementById('confirmAgentActions').addEventListener('change', function (e) { save({ confirmAgentActions: e.target.checked }) })
  document.getElementById('usePageContext').addEventListener('change', function (e) { save({ usePageContext: e.target.checked }) })
  document.getElementById('pageMemory').addEventListener('change', function (e) { save({ pageMemory: e.target.checked }) })
  document.getElementById('adblock').addEventListener('change', function (e) { save({ adblock: e.target.checked }) })
  document.getElementById('shieldsAggressive').addEventListener('change', function (e) { save({ shieldsAggressive: e.target.checked }) })

  function renderShieldPresets(s) {
    var wrap = document.getElementById('shieldPresets')
    if (!wrap || !s.presets) return
    wrap.innerHTML = ''
    s.presets.forEach(function (p) {
      var label = document.createElement('label')
      var box = document.createElement('input')
      box.type = 'checkbox'
      box.className = 'shield-preset'
      box.value = p.id
      box.checked = !!p.enabled
      box.addEventListener('change', function () {
        save({ filterPresetIds: currentPresetIds() }).then(function () { renderShieldLists() })
      })
      label.appendChild(box)
      label.appendChild(document.createTextNode(' ' + p.name))
      wrap.appendChild(label)
    })
  }
  function currentPresetIds() {
    var ids = []
    var boxes = document.querySelectorAll('.shield-preset')
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) ids.push(boxes[i].value)
    return ids
  }
  function renderShieldLists() {
    window.aether.internal.adblockLists().then(function (st) {
      var table = document.getElementById('listTable')
      var status = document.getElementById('listStatus')
      if (!table) return
      table.innerHTML = ''
      var lists = st.lists || []
      if (status) status.textContent = lists.length ? ('Custom lists active: ' + lists.filter(function (l) { return l.status !== 'error' }).length + '/' + lists.length) : 'No custom lists — the built-in EasyList + EasyPrivacy engine is active.'
      lists.forEach(function (l) {
        var row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px'
        var name = document.createElement('span')
        name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85'
        name.textContent = l.url
        name.title = l.url + ' (' + l.status + ')'
        var badge = document.createElement('span')
        badge.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:8px;' + (l.status === 'error' ? 'background:var(--ax-danger-border);color:var(--ax-danger)' : 'background:var(--ax-ok-soft);color:var(--ax-ok)')
        badge.textContent = l.status
        var rm = document.createElement('button')
        rm.className = 'btn'
        rm.textContent = 'Remove'
        rm.addEventListener('click', function () {
          window.aether.internal.removeAdblockList(l.url).then(function () { renderShieldLists() })
        })
        row.appendChild(name)
        row.appendChild(badge)
        row.appendChild(rm)
        table.appendChild(row)
      })
    }).catch(function () {})
  }
  document.getElementById('listAdd').addEventListener('click', function () {
    var input = document.getElementById('listUrl')
    var url = input.value.trim()
    if (!url) return
    window.aether.internal.addAdblockList(url).then(function (res) {
      input.value = ''
      if (!res || !res.ok) window.alert(res && res.error ? res.error : 'Could not add that list')
      renderShieldLists()
    }).catch(function (err) { window.alert(String(err && err.message ? err.message : err)) })
  })

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

export const ERROR_HTML = pageShell(
  'Can\u2019t reach this page',
  `
  <div style="width:min(620px,90vw); margin-top:14vh;">
    <div style="font-size:46px; line-height:1;">🌐</div>
    <h1 id="err-title" style="margin-top:18px; font-size:24px; font-weight:600;">Can\u2019t reach this page</h1>
    <p id="err-detail" style="margin-top:10px; color:var(--ax-muted); font-size:14px; line-height:1.6;"></p>
    <div id="err-url" style="margin-top:14px; padding:10px 14px; background:var(--ax-card); border:1px solid var(--ax-border);
      border-radius:10px; color:var(--ax-fg); font-size:12px; -webkit-user-select:text; user-select:text;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
    <div style="margin-top:26px; display:flex; gap:10px; flex-wrap:wrap;">
      <button id="err-retry" style="padding:11px 22px; font-size:14px; color:var(--ax-bg); background:var(--ax-accent);
        border:none; border-radius:10px; cursor:pointer; font-weight:600;">Try again</button>
      <button id="err-noadblock" style="display:none; padding:11px 22px; font-size:14px; color:var(--ax-fg);
        background:var(--ax-card); border:1px solid var(--ax-border-hi); border-radius:10px; cursor:pointer;">Turn off ad blocker &amp; retry</button>
      <button id="err-newtab" style="padding:11px 22px; font-size:14px; color:var(--ax-muted); background:transparent;
        border:1px solid var(--ax-border); border-radius:10px; cursor:pointer;">New tab</button>
    </div>
    <p id="err-hint" style="margin-top:22px; color:var(--ax-faint); font-size:12px; line-height:1.7;"></p>
    <div id="err-bridge" style="display:none; margin-top:16px; padding:12px 16px; background:var(--ax-danger-bg);
      border:1px solid var(--ax-danger-border); border-radius:10px; color:var(--ax-danger); font-size:13px; line-height:1.5;"></div>
    <div style="margin-top:26px; color:var(--ax-faint); font-size:11px;">Aether Browser ${VER}</div>
  </div>
  `,
  `
  var params = new URLSearchParams(location.search)
  var u = params.get('u') || ''
  var c = parseInt(params.get('c') || '0', 10)
  var d = params.get('d') || ''

  var TITLES = {}
  TITLES['-6'] = ['File not found', 'The address points to a file that does not exist on this site.']
  TITLES['-7'] = ['Took too long to load', 'The server did not respond in time. It may be down or your connection is too slow.']
  TITLES['-10'] = ['Access denied', 'The server refused to serve this page to this browser.']
  TITLES['-20'] = ['Blocked by the ad blocker', 'The built-in ad blocker cancelled this page request. If this site is a false positive, turn the blocker off and retry.']
  TITLES['-21'] = ['Blocked', 'Something on this device or network blocked the page request.']
  TITLES['-100'] = ['Connection closed', 'The connection was closed unexpectedly while loading. The site may be down.']
  TITLES['-101'] = ['Connection reset', 'The connection was reset — the site or your network dropped it. A VPN or firewall can cause this.']
  TITLES['-102'] = ['Server refused the connection', 'Nothing is accepting connections at that address right now. The site may be down, or your network blocks it.']
  TITLES['-103'] = ['Connection aborted', 'The connection was aborted mid-transfer.']
  TITLES['-104'] = ['Connection failed', 'Could not establish a connection to the site.']
  TITLES['-105'] = ['Address not found (DNS)', 'This domain could not be resolved. Check the spelling, your internet connection, and whether your network or ISP blocks this site — college and office Wi-Fi often do.']
  TITLES['-106'] = ['No internet connection', 'Your device appears to be offline. Check Wi-Fi / ethernet, then try again.']
  TITLES['-109'] = ['Address unreachable', 'The host was reached but the address could not be connected to — often a VPN, proxy or routing problem.']
  TITLES['-118'] = ['Connection timed out', 'The server took too long to accept the connection. It may be down, or your network is blocking or throttling it.']
  TITLES['-130'] = ['Proxy related failure', 'The configured proxy could not load this page. Check your proxy or VPN.']
  TITLES['-200'] = ['Certificate error', 'The site\u2019s security certificate does not match its name.']
  TITLES['-201'] = ['Certificate error', 'The site\u2019s security certificate is expired or not yet valid.']
  TITLES['-202'] = ['Certificate error', 'The site\u2019s certificate was issued by an unknown authority. Do not enter passwords on this site.']
  TITLES['-310'] = ['Too many redirects', 'The site redirected in a loop. Clearing cookies for the site in Settings can help.']
  TITLES['-324'] = ['Empty response', 'The server closed the connection without sending any data.']
  TITLES['-50'] = ['Insecure response', 'The server sent a response that failed security validation.']

  var entry = TITLES[String(c)]
  var crash = c === -1000
  document.getElementById('err-title').textContent = crash
    ? 'This page crashed'
    : (entry ? entry[0] : 'Can\u2019t reach this page')
  var detail = crash
    ? 'The page\u2019s renderer stopped unexpectedly — usually a site bug, rarely a browser problem. Retrying usually fixes it.'
    : (entry ? entry[1] : 'The page failed to load. Retrying may help; the technical reason is shown below.')
  if (d) detail += '  (' + d + ' — code ' + c + ')'
  document.getElementById('err-detail').textContent = detail
  document.getElementById('err-url').textContent = u || '(unknown address)'

  var hint = document.getElementById('err-hint')
  var hints = []
  if (c === -20 || c === -21) {
    hints.push('Turned the blocker off by mistake before? You can re-enable it anytime in Settings → Privacy.')
  } else {
    hints.push('If the site opens but looks broken or stuck, the built-in ad blocker can occasionally interfere — toggle it in Settings → Privacy and reload.')
  }
  if (u && u.indexOf('https://www.youtube.com') === 0) {
    hints.push('YouTube tip: sign-in walls and rare regional blocks can also cause empty pages. If "Try again" does not help, test the same address in another browser to rule out your network.')
  }
  hint.textContent = hints.join(' ')

  var bridge = document.getElementById('err-bridge')
  function bridgeDown(msg) { bridge.style.display = 'block'; bridge.textContent = msg }
  if (typeof window.aether === 'undefined') {
    bridgeDown('UI bridge unavailable — buttons cannot talk to the browser. Fully quit Aether and start it again; if it keeps happening, run: npm run build')
  }
  document.getElementById('err-retry').addEventListener('click', function () {
    if (!u) return
    try { window.aether.internal.open(u) } catch (e) { bridgeDown('Browser bridge unavailable (' + (e && e.message) + ').') }
  })
  var noad = document.getElementById('err-noadblock')
  if (c === -20 || c === -21) {
    noad.style.display = 'inline-block'
    noad.addEventListener('click', function () {
      if (!u) return
      try {
        window.aether.internal.disableAdblock(u)
      } catch (e) { bridgeDown('Browser bridge unavailable (' + (e && e.message) + ').') }
    })
  }
  document.getElementById('err-newtab').addEventListener('click', function () {
    try { window.aether.tabs.create('aether://newtab') } catch (e) { bridgeDown('Browser bridge unavailable (' + (e && e.message) + ').') }
  })
  `
)
