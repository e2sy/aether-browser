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
    Aether Browser 0.1.0 — local AI, open source
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
