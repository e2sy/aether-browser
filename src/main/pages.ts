/**
 * Internal pages served over the aether:// protocol.
 * Kept as inline HTML strings so packaging needs zero static file handling.
 * NOTE: page scripts are plain ES5-ish and must NOT contain backticks or ${
 * (outside the template placeholders below).
 */
import { app, nativeTheme } from 'electron'
import crypto from 'node:crypto'
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

/**
 * CSP v2 — the XSS backstop for every internal page.
 *
 * Scripts execute ONLY with a per-boot random nonce. Any script that
 * untrusted content manages to inject (a `<script>` from a history title,
 * a search snippet, a bookmark name, a suggestion row…) has no nonce, so
 * Chromium refuses to run it. Inline event handlers are equally dead —
 * internal pages use addEventListener exclusively.
 *
 * `style-src 'unsafe-inline'` stays by deliberate tradeoff: internal pages
 * style themselves through `style="…"` attributes everywhere, and nonce-ing
 * style BLOCKS does not cover style attributes. Style injection can
 * exfiltrate at worst; it cannot execute code. Script execution is the
 * threat that matters — and it is now nonce-locked.
 *
 * Everything else is closed: no objects, no frames (meta) + frame-ancestors
 * none (header — meta CSP ignores frame-ancestors), no form action, no
 * base hijack. Nonce rotates every boot, so even a captured past page
 * cannot run today.
 */
export function internalCsp(nonce: string, asHeader = false): string {
  const parts = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    'img-src https: data:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ]
  if (asHeader) parts.push("frame-ancestors 'none'")
  return parts.join('; ')
}

function pageShell(title: string, body: string, script: string): string {
  const nonce = crypto.randomBytes(16).toString('base64')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${internalCsp(nonce)}">
<title>${title}</title>
<style>${BASE_CSS}</style>
<style>${appearanceCss(mergedSettings().appearance, nativeTheme.shouldUseDarkColors)}</style>
</head>
<body>
${body}
<script nonce="${nonce}">${script}</script>
</body>
</html>`
}

/**
 * Response headers for serving an internal page: re-emits the page's own CSP
 * as a real HTTP header (meta CSP ignores `frame-ancestors`, headers don't —
 * so internal pages can never be framed by a hostile page) and disables
 * MIME sniffing. Extracts the nonce from the page's meta tag so header and
 * meta always agree.
 */
export function pageSecurityHeaders(html: string): Record<string, string> {
  const m = /<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'nonce-([^']+)'/.exec(html)
  const nonce = m ? m[1] : crypto.randomBytes(16).toString('base64')
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': internalCsp(nonce, true),
    'x-content-type-options': 'nosniff'
  }
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
  <div style="margin-top:44px; width:min(640px,88vw); display:grid; grid-template-columns: 1fr 1fr; gap:22px; align-items:start;" id="widgets">
    <div>
      <div style="color:var(--ax-muted); font-size:12px; letter-spacing:.1em; margin-bottom:14px;">TOP SITES</div>
      <div id="top" style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px;"></div>
    </div>
    <div>
      <div style="color:var(--ax-muted); font-size:12px; letter-spacing:.1em; margin-bottom:14px;">QUICK NOTES</div>
      <textarea id="quicknotes" placeholder="Scratchpad — saved on this device as you type…"
        style="width:100%; min-height:170px; resize:vertical; padding:12px 14px; font-size:13px; line-height:1.55; color:var(--ax-fg);
        background:var(--ax-card); border:1px solid var(--ax-border); border-radius:12px; outline:none;
        font-family:inherit;"></textarea>
      <div id="notes-status" style="font-size:10.5px; color:var(--ax-faint); margin-top:5px; text-align:right;">saved locally</div>
    </div>
  </div>
  <div style="margin-top:26px; width:min(640px,88vw);">
    <div style="color:var(--ax-muted); font-size:12px; letter-spacing:.1em; margin-bottom:14px;" id="bm-label">BOOKMARKS</div>
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
  // quick notes widget (New Tab v3, #44) — debounced save, sanitized by main
  try {
    var nt = document.getElementById('quicknotes')
    var nsStatus = document.getElementById('notes-status')
    var nsTimer = null
    window.aether.notes.get().then(function (txt) {
      nt.value = typeof txt === 'string' ? txt : ''
    }).catch(function () {})
    nt.addEventListener('input', function () {
      if (nsTimer) clearTimeout(nsTimer)
      nsStatus.textContent = 'saving…'
      nsTimer = setTimeout(function () {
        window.aether.notes.set(nt.value).then(function () {
          nsStatus.textContent = 'saved locally'
        }).catch(function () { nsStatus.textContent = 'could not save' })
      }, 500)
    })
  } catch (e) {}
  `
)

export const SEARCH_HTML = pageShell(
  'Aether Search',
  `
  <style>
    .s-head { position:sticky; top:0; z-index:20; width:min(760px,94vw);
      background:var(--ax-bg); padding:16px 0 12px; border-bottom:1px solid var(--ax-border); }
    .s-logo-row { display:flex; align-items:baseline; gap:10px; margin-bottom:12px; }
    .s-logo { font-size:24px; font-weight:700; letter-spacing:-0.02em; }
    .s-logo span { color:var(--ax-accent); }
    .s-tag { font-size:11.5px; color:var(--ax-muted2); }
    .s-bar { display:flex; gap:10px; position:relative; }
    .s-inputwrap { flex:1; position:relative; }
    .s-inputwrap input { width:100%; padding:13px 40px 13px 18px; font-size:14px; color:var(--ax-fg);
      background:var(--ax-card); border:1px solid var(--ax-border); border-radius:12px; outline:none; }
    .s-inputwrap input:focus { border-color:var(--ax-accent); }
    .s-clear { position:absolute; right:10px; top:50%; transform:translateY(-50%); width:22px; height:22px;
      border:none; border-radius:50%; background:var(--ax-card2); color:var(--ax-muted);
      font-size:13px; line-height:1; cursor:pointer; display:none; }
    .s-clear:hover { color:var(--ax-fg); background:var(--ax-border-hi); }
    #sugg { position:absolute; left:0; right:0; top:calc(100% + 6px); margin:0; padding:6px; list-style:none;
      background:var(--ax-card); border:1px solid var(--ax-border-hi); border-radius:12px;
      box-shadow:0 12px 32px rgba(0,0,0,.45); display:none; z-index:30; }
    #sugg li { padding:9px 12px; font-size:13px; color:var(--ax-muted); border-radius:8px;
      cursor:pointer; display:flex; gap:9px; align-items:center; }
    #sugg li .mag { color:var(--ax-faint); font-size:12px; }
    #sugg li.sel, #sugg li:hover { background:var(--ax-card2); color:var(--ax-fg); }
    .s-btn { padding:13px 20px; font-size:13px; font-weight:600; color:#fff;
      background:var(--ax-accent2); border:none; border-radius:12px; cursor:pointer; }
    .s-btn:hover { filter:brightness(1.1); }
    .s-btn.ghost { background:var(--ax-card); color:var(--ax-muted); border:1px solid var(--ax-border); }
    .s-hint { margin-top:10px; font-size:12px; color:var(--ax-muted);
      background:var(--ax-accent-soft); border:1px solid var(--ax-border-hi);
      border-radius:10px; padding:8px 12px; }
    .s-hint b { color:var(--ax-accent-tint); }
    .s-main { width:min(760px,94vw); padding-bottom:60px; }
    .s-instant { margin-top:18px; background:linear-gradient(135deg,var(--ax-accent-soft),transparent);
      border:1px solid var(--ax-border-hi); border-radius:14px; padding:16px 20px; }
    .s-instant .out { font-size:26px; font-weight:600; color:var(--ax-accent-tint); letter-spacing:-0.01em; }
    .s-instant .in { margin-top:5px; font-size:11px; color:var(--ax-muted2); }
    .s-panel { margin-top:18px; display:flex; gap:16px; background:var(--ax-card);
      border:1px solid var(--ax-border); border-radius:14px; padding:18px 20px; }
    .s-panel img { width:104px; height:104px; border-radius:10px; object-fit:cover; flex:none;
      background:var(--ax-card2); }
    .s-panel .pt { font-size:16px; font-weight:650; color:var(--ax-fg); }
    .s-panel .pu { font-size:10.5px; letter-spacing:.07em; color:var(--ax-accent); margin-top:2px; }
    .s-panel .px { font-size:12.5px; line-height:1.6; color:var(--ax-muted); margin-top:8px;
      display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
    .s-status { margin-top:20px; color:var(--ax-muted); font-size:13px; }
    .s-filters { margin-top:14px; display:flex; flex-wrap:wrap; gap:6px; }
    .s-filters button { font-size:11px; padding:4px 11px; border-radius:20px; cursor:pointer;
      border:1px solid var(--ax-border); background:var(--ax-card2); color:var(--ax-muted); }
    .s-filters button.on { background:var(--ax-accent-soft); color:var(--ax-accent);
      border-color:var(--ax-border-hi); font-weight:600; }
    .s-stats { margin-top:8px; font-size:11px; color:var(--ax-faint); }
    .s-results { margin-top:10px; padding:0; list-style:none; }
    .s-res { padding:13px 16px; margin-bottom:8px; background:var(--ax-card2);
      border:1px solid var(--ax-border); border-radius:10px; cursor:pointer;
      display:flex; gap:12px; align-items:flex-start; }
    .s-res:hover, .s-res.sel { border-color:var(--ax-border-hi); background:var(--ax-card); }
    .s-res.sel { outline:1px solid var(--ax-accent); }
    .s-tile { width:28px; height:28px; border-radius:8px; flex:none; display:flex; align-items:center;
      justify-content:center; font-weight:700; font-size:13px; color:#fff; }
    .s-body { min-width:0; flex:1; }
    .s-title { font-size:13.5px; color:var(--ax-accent-tint); font-weight:600; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    .s-meta { display:flex; gap:8px; align-items:center; margin-top:3px; min-width:0; }
    .s-url { font-size:11px; color:var(--ax-faint); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .s-badge { font-size:9.5px; letter-spacing:.06em; padding:1px 7px; border-radius:20px;
      background:var(--ax-accent-soft); color:var(--ax-accent); font-weight:600; flex:none; }
    .s-snippet { font-size:12px; color:var(--ax-muted); margin-top:4px; line-height:1.55;
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .s-actions { display:flex; flex-direction:column; gap:6px; flex:none; }
    .s-actions button { width:26px; height:26px; border:1px solid var(--ax-border); border-radius:7px;
      background:transparent; color:var(--ax-faint); font-size:12px; cursor:pointer; }
    .s-actions button:hover { color:var(--ax-fg); background:var(--ax-card2); }
    .s-related { margin-top:18px; }
    .s-related .rl { font-size:11px; letter-spacing:.08em; color:var(--ax-faint); margin-bottom:8px; }
    .s-related .chips { display:flex; flex-wrap:wrap; gap:7px; }
    .s-related .chips button { font-size:12px; padding:7px 13px; border-radius:18px; cursor:pointer;
      background:var(--ax-card2); border:1px solid var(--ax-border); color:var(--ax-muted); }
    .s-related .chips button:hover { color:var(--ax-fg); border-color:var(--ax-border-hi); }
    .s-ai { margin-top:18px; background:var(--ax-card); border:1px solid var(--ax-border);
      border-radius:14px; padding:18px 20px; }
    .s-ai-label { font-size:11px; letter-spacing:.09em; color:var(--ax-accent); margin-bottom:9px; }
    .s-ai-body { font-size:14px; line-height:1.65; white-space:pre-wrap; }
    .s-try { margin-top:22px; }
    .s-try .tl { font-size:11px; letter-spacing:.08em; color:var(--ax-faint); margin-bottom:8px; }
    .s-try .chips { display:flex; flex-wrap:wrap; gap:7px; }
    .s-try .chips button { font-size:12px; padding:7px 13px; border-radius:18px; cursor:pointer;
      background:var(--ax-card2); border:1px solid var(--ax-border); color:var(--ax-muted); }
    .s-try .chips button:hover { color:var(--ax-fg); border-color:var(--ax-border-hi); }
    .s-bangs { margin-top:14px; display:flex; flex-wrap:wrap; gap:7px; }
    .s-bangs button { font-size:12px; padding:6px 12px; border-radius:18px; cursor:pointer;
      background:transparent; border:1px dashed var(--ax-border-hi); color:var(--ax-muted2); }
    .s-bangs b { color:var(--ax-accent); font-weight:700; }
    .s-foot { margin-top:34px; padding-bottom:26px; color:var(--ax-faint); font-size:11px; line-height:1.7; }
    #gfallback a { display:inline-block; padding:10px 18px; font-size:13px; font-weight:600; color:#fff;
      background:var(--ax-accent2); border-radius:10px; cursor:pointer; text-decoration:none; }
  </style>
  <div class="s-head">
    <div class="s-logo-row">
      <div class="s-logo">aether<span>Search</span></div>
      <div class="s-tag">beast-mode metasearch — every result says where it came from</div>
    </div>
    <div class="s-bar">
      <div class="s-inputwrap">
        <input id="q" type="text" placeholder="Search, or try !yt cats · 10 km to miles · time in tokyo"
          autocomplete="off" spellcheck="false" />
        <button id="clear" class="s-clear" title="Clear">×</button>
        <ul id="sugg"></ul>
      </div>
      <button id="go" class="s-btn">Search</button>
    </div>
    <div id="hint" class="s-hint" style="display:none;"></div>
  </div>
  <main class="s-main">
    <div id="instant" class="s-instant" style="display:none;"></div>
    <div id="panel" class="s-panel" style="display:none;"></div>
    <div id="status" class="s-status"></div>
    <div id="filters" class="s-filters" style="display:none;"></div>
    <ol id="results" class="s-results"></ol>
    <div id="related" class="s-related" style="display:none;"></div>
    <div id="try" class="s-try" style="display:none;"></div>
    <div id="aiwrap" class="s-ai" style="display:none;">
      <div class="s-ai-label">AI ANSWER — LOCAL MODEL</div>
      <div id="answer" class="s-ai-body"></div>
    </div>
    <div id="gfallback" style="margin-top:14px; display:none;"></div>
    <div class="s-foot">
      Aether Search aggregates public sources, strips tracking parameters, deduplicates,
      de-clumps same-domain results and ranks everything locally. No profiling, no ad network,
      nothing stored beyond this device's history.
    </div>
  </main>
  `,
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  function host(u) { return String(u || '').replace(/^https?:\\\\/\\\\//, '').split('/')[0] }
  function $(id) { return document.getElementById(id) }

  var state = { all: [], filter: 'All', sel: -1, query: '' }
  var TILES = ['#5b8def', '#9a6ff0', '#e0679b', '#e0975b', '#4fb286', '#4fb0c6', '#c67f4f', '#7f8ff0', '#b05bd6', '#5ba7a0']
  var TRY = ['qwen3 ollama', 'best mechanical keyboards 2026', '10 km to miles', '15% of 80', 'time in tokyo']
  var BANG_SHOWN = [['g','Google'], ['yt','YouTube'], ['w','Wikipedia'], ['gh','GitHub'], ['so','Stack Overflow'], ['r','Reddit'], ['x','X (Twitter)'], ['a','Amazon'], ['fk','Flipkart'], ['sp','Spotify'], ['tr','Translate'], ['maps','Maps']]

  function tileColor(h) {
    var n = 0
    for (var i = 0; i < h.length; i++) n = (n * 31 + h.charCodeAt(i)) >>> 0
    return TILES[n % TILES.length]
  }
  function tileEl(h) {
    var t = document.createElement('div')
    t.className = 's-tile'
    t.style.background = tileColor(h)
    t.textContent = (h.replace(/^www\\./, '')[0] || '?').toUpperCase()
    return t
  }
  function copyUrl(u) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(u).catch(function () { legacyCopy(u) })
    } else legacyCopy(u)
  }
  function legacyCopy(u) {
    var ta = document.createElement('textarea')
    ta.value = u; ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch (e) {}
    document.body.removeChild(ta)
  }

  /* ---------------- suggestions dropdown ---------------- */
  var suggOpen = false, suggSel = -1, suggList = [], suggTimer = null
  function hideSugg() { suggOpen = false; suggSel = -1; $('sugg').style.display = 'none' }
  function renderSugg() {
    var ul = $('sugg')
    ul.innerHTML = ''
    if (!suggList.length) { hideSugg(); return }
    for (var i = 0; i < suggList.length; i++) {
      var li = document.createElement('li')
      if (i === suggSel) li.className = 'sel'
      var mag = document.createElement('span'); mag.className = 'mag'; mag.textContent = '⌕'
      li.appendChild(mag); li.appendChild(esc(suggList[i]))
      ;(function (q) {
        li.addEventListener('mousedown', function (e) { e.preventDefault(); pickSugg(q) })
      })(suggList[i])
      ul.appendChild(li)
    }
    ul.style.display = 'block'
    suggOpen = true
  }
  function pickSugg(q) { hideSugg(); $('q').value = q; run(q) }
  function fetchSugg() {
    var q = $('q').value.trim()
    if (q.length < 3 || q.charAt(0) === '!') { suggList = []; renderSugg(); return }
    window.aether.internal.suggest(q).then(function (list) {
      var cur = $('q').value.trim()
      if (cur !== q) return
      suggList = (list || []).slice(0, 8); suggSel = -1; renderSugg()
    }).catch(function () {})
  }

  /* ---------------- instant answers + bang hint ---------------- */
  var hintTimer = null
  function renderInstant(a) {
    var box = $('instant')
    if (!a || a.kind === 'bang') { box.style.display = 'none'; return }
    box.innerHTML = ''
    var out = esc(a.output); out.className = 'out'
    var inr = document.createElement('div'); inr.className = 'in'
    inr.textContent = (a.input || '') + ' — Aether instant answer, computed on this device, no network'
    box.appendChild(out); box.appendChild(inr)
    box.style.display = 'block'
  }
  function bangHint(a) {
    var h = $('hint')
    if (!a || a.kind !== 'bang') { h.style.display = 'none'; return }
    h.innerHTML = ''
    h.appendChild(esc('Press Enter to open '))
    var b = document.createElement('b'); b.textContent = a.name + (a.output ? ' — ' + a.output : ' home')
    h.appendChild(b)
    h.appendChild(esc(' (bang !' + (a.input.replace(/^!+/, '').split(/\\s+/)[0] || '') + ')'))
    h.style.display = 'block'
  }
  function livePreview() {
    var q = $('q').value.trim()
    $('clear').style.display = q ? 'block' : 'none'
    if (hintTimer) clearTimeout(hintTimer)
    if (!q) { $('hint').style.display = 'none'; $('instant').style.display = 'none'; hideSugg(); return }
    hintTimer = setTimeout(function () {
      var cur = $('q').value.trim()
      if (cur !== q) return
      window.aether.internal.instant(q).then(function (a) {
        if ($('q').value.trim() !== q) return
        bangHint(a)
        renderInstant(a)
      }).catch(function () {})
      fetchSugg()
    }, 170)
  }

  /* ---------------- results rendering ---------------- */
  function statusMsg(t, isErr) {
    var s = $('status')
    s.textContent = t || ''
    s.style.color = isErr ? 'var(--ax-danger)' : ''
  }
  function sourceCounts() {
    var m = {}
    for (var i = 0; i < state.all.length; i++) {
      var src = state.all[i].source || 'web'
      m[src] = (m[src] || 0) + 1
    }
    return m
  }
  function renderFilters() {
    var box = $('filters')
    var counts = sourceCounts()
    var keys = Object.keys(counts)
    if (!keys.length) { box.style.display = 'none'; return }
    box.innerHTML = ''
    var mk = function (label, val, n) {
      var b = document.createElement('button')
      b.textContent = label + (n != null ? ' ' + n : '')
      if (state.filter === val) b.className = 'on'
      b.addEventListener('click', function () { state.filter = val; state.sel = -1; renderFilters(); renderResults() })
      return b
    }
    box.appendChild(mk('All', 'All', state.all.length))
    keys.sort().forEach(function (k) { box.appendChild(mk(k, k, counts[k])) })
    box.style.display = 'flex'
  }
  function renderStats(elapsedMs) {
    var n = state.all.length
    if (!n) return
    var sc = sourceCounts()
    var line = n + ' results · ' + Object.keys(sc).length + ' of ' + LAST_STATS.length + ' sources'
    if (elapsedMs) line += ' · ' + (elapsedMs / 1000).toFixed(1) + ' s'
    line += ' · tracking stripped'
    var el = document.createElement('div')
    el.className = 's-stats'
    el.textContent = line
    var box = $('filters')
    var old = box.parentNode.querySelector('.s-stats')
    if (old) old.remove()
    box.parentNode.insertBefore(el, box.nextSibling)
  }
  function openResult(u) { window.aether.internal.open(u) }
  function renderResults() {
    var box = $('results')
    box.innerHTML = ''
    var list = state.filter === 'All' ? state.all : state.all.filter(function (r) { return (r.source || 'web') === state.filter })
    for (var i = 0; i < list.length; i++) {
      var r = list[i]
      var li = document.createElement('li')
      li.className = 's-res' + (i === state.sel ? ' sel' : '')
      var h = host(r.url)
      li.appendChild(tileEl(h))
      var body = document.createElement('div'); body.className = 's-body'
      var t = esc(r.title); t.className = 's-title'
      var meta = document.createElement('div'); meta.className = 's-meta'
      var u = esc(h); u.className = 's-url'
      meta.appendChild(u)
      if (r.source) {
        var badge = document.createElement('span'); badge.className = 's-badge'
        badge.textContent = String(r.source).toUpperCase()
        meta.appendChild(badge)
      }
      var sn = esc(r.snippet); sn.className = 's-snippet'
      body.appendChild(t); body.appendChild(meta); body.appendChild(sn)
      li.appendChild(body)
      var acts = document.createElement('div'); acts.className = 's-actions'
      var copy = document.createElement('button')
      copy.title = 'Copy link'; copy.textContent = '⧉'
      copy.addEventListener('click', function (url) {
        return function (e) { e.stopPropagation(); copyUrl(url) }
      }(r.url))
      acts.appendChild(copy)
      li.appendChild(acts)
      ;(function (url) {
        li.addEventListener('click', function () { openResult(url) })
        li.addEventListener('auxclick', function (e) { if (e.button === 1) { e.preventDefault(); openResult(url) } })
      })(r.url)
      box.appendChild(li)
    }
    if (list.length) { $('status').textContent = ''; $('status').style.color = '' }
  }
  function renderPanel(p) {
    var box = $('panel')
    if (!p || !p.title) { box.style.display = 'none'; return }
    box.innerHTML = ''
    if (p.thumbnail) {
      var img = document.createElement('img')
      img.src = p.thumbnail; img.alt = ''
      img.addEventListener('error', function () { img.remove() })
      box.appendChild(img)
    }
    var body = document.createElement('div')
    var t = document.createElement('div'); t.className = 'pt'; t.textContent = p.title
    var u = document.createElement('div'); u.className = 'pu'; u.textContent = 'WIKIPEDIA · KNOWLEDGE PANEL'
    var x = document.createElement('div'); x.className = 'px'; x.textContent = p.extract
    body.appendChild(t); body.appendChild(u); body.appendChild(x)
    var more = document.createElement('a')
    more.href = '#'; more.textContent = 'Read on Wikipedia →'
    more.style.cssText = 'display:inline-block;margin-top:10px;font-size:12px;color:var(--ax-accent);cursor:pointer'
    more.addEventListener('click', function (e) { e.preventDefault(); openResult(p.url) })
    body.appendChild(more)
    box.appendChild(body)
    box.style.display = 'flex'
  }
  function renderRelated(list) {
    var box = $('related')
    if (!list || !list.length) { box.style.display = 'none'; return }
    box.innerHTML = ''
    var l = document.createElement('div'); l.className = 'rl'; l.textContent = 'RELATED SEARCHES'
    var chips = document.createElement('div'); chips.className = 'chips'
    for (var i = 0; i < list.length; i++) {
      var b = document.createElement('button')
      b.textContent = list[i]
      ;(function (q) { b.addEventListener('click', function () { window.aether.internal.search(q) }) })(list[i])
      chips.appendChild(b)
    }
    box.appendChild(l); box.appendChild(chips)
    box.style.display = 'block'
  }
  function renderTry() {
    var box = $('try')
    box.innerHTML = ''
    var l = document.createElement('div'); l.className = 'tl'; l.textContent = 'TRY A SEARCH'
    var chips = document.createElement('div'); chips.className = 'chips'
    for (var i = 0; i < TRY.length; i++) {
      var b = document.createElement('button'); b.textContent = TRY[i]
      ;(function (q) { b.addEventListener('click', function () { $('q').value = q; run(q) }) })(TRY[i])
      chips.appendChild(b)
    }
    box.appendChild(l); box.appendChild(chips)
    var bl = document.createElement('div'); bl.className = 'tl'; bl.style.marginTop = '16px'
    bl.textContent = 'BANGS — JUMP STRAIGHT TO A SITE'
    var bangs = document.createElement('div'); bangs.className = 's-bangs'
    for (var j = 0; j < BANG_SHOWN.length; j++) {
      var bb = document.createElement('button')
      var k = document.createElement('b'); k.textContent = '!' + BANG_SHOWN[j][0] + ' '
      bb.appendChild(k); bb.appendChild(esc(BANG_SHOWN[j][1]))
      ;(function (q) { bb.addEventListener('click', function () { $('q').value = q; $('q').focus(); livePreview() }) })('!' + BANG_SHOWN[j][0] + ' ')
      bangs.appendChild(bb)
    }
    box.appendChild(bl); box.appendChild(bangs)
    box.style.display = 'block'
  }
  function showGoogle(q, url) {
    var wrap = $('gfallback')
    wrap.innerHTML = ''
    var btn = document.createElement('a')
    btn.href = '#'
    btn.textContent = 'Search on Google instead'
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      window.aether.internal.open(url || ('https://www.google.com/search?q=' + encodeURIComponent(q)))
    })
    wrap.appendChild(btn)
    wrap.style.display = 'block'
  }

  /* ---------------- main run ---------------- */
  var LAST_STATS = []
  var gotData = false
  function run(q) {
    q = String(q || '').trim()
    if (!q) return
    state.query = q
    state.all = []; state.filter = 'All'; state.sel = -1
    $('q').value = q
    hideSugg(); $('hint').style.display = 'none'
    $('instant').style.display = 'none'; $('panel').style.display = 'none'
    $('filters').style.display = 'none'; $('results').innerHTML = ''
    $('related').style.display = 'none'; $('try').style.display = 'none'
    $('aiwrap').style.display = 'none'; $('answer').textContent = ''
    $('gfallback').style.display = 'none'; $('gfallback').innerHTML = ''
    var oldStats = document.querySelector('.s-stats'); if (oldStats) oldStats.remove()
    gotData = false
    var t0 = Date.now()
    statusMsg('Searching the web — running every source in parallel…')

    // resolve bangs / instant answers FIRST (local, instant) — a bang replaces
    // the search entirely, so the web pipeline only starts for real queries
    window.aether.internal.instant(q).then(function (a) {
      if (a && a.kind === 'bang') {
        statusMsg('Bang !' + (q.replace(/^!+/, '').split(/\\s+/)[0] || '') + ' → opening ' + a.name + '…')
        window.aether.internal.open(a.url)
        return
      }
      renderInstant(a)
      startWeb(q, t0)
    }).catch(function () { startWeb(q, t0) })
  }

  function startWeb(q, t0) {
    if (state.query !== q) return
    var watchdog = setTimeout(function () {
      if (!gotData) {
        statusMsg('The sources did not respond in time. Try again, or use Google below.', true)
        showGoogle(q, '')
      }
    }, 25000)

    var req = window.aether.internal.ask(q)
    req.onData(function (d) {
      gotData = true
      if (d.stats) LAST_STATS = d.stats
      if (d.panel) renderPanel(d.panel)
      if (d.sources) {
        state.all = d.sources
        renderFilters(); renderResults(); renderStats(Date.now() - t0)
        if (d.sources.length) statusMsg('')
        else if (!d.error) statusMsg('No web results found for this query.')
      }
      if (d.related) renderRelated(d.related)
      if (d.googleFallback) showGoogle(q, d.googleFallback)
      if (d.delta) {
        $('aiwrap').style.display = 'block'
        $('answer').textContent += d.delta
        if ($('status').style.color !== 'var(--ax-danger)') statusMsg('')
      }
      if (d.error) statusMsg(d.error, true)
      if (d.done) clearTimeout(watchdog)
    })
    req.result.then(function (r) {
      clearTimeout(watchdog)
      if (r && r.error && !gotData) {
        statusMsg(String(r.error), true)
        showGoogle(q, '')
      }
    })
  }

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', function (e) {
    var inInput = document.activeElement === $('q')
    // suggestions navigation
    if (suggOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      suggSel = e.key === 'ArrowDown'
        ? (suggSel + 1) % suggList.length
        : (suggSel - 1 + suggList.length) % suggList.length
      renderSugg()
      return
    }
    if (suggOpen && e.key === 'Enter' && suggSel >= 0) {
      e.preventDefault(); pickSugg(suggList[suggSel]); return
    }
    if (e.key === 'Escape' && suggOpen) { hideSugg(); return }
    // result navigation (dropdown closed)
    var list = state.filter === 'All' ? state.all : state.all.filter(function (r) { return (r.source || 'web') === state.filter })
    if (!inInput && list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      state.sel = e.key === 'ArrowDown'
        ? Math.min(state.sel + 1, list.length - 1)
        : Math.max(state.sel - 1, 0)
      renderResults()
      var el = $('results').children[state.sel]
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
      return
    }
    if (!inInput && e.key === 'Enter' && state.sel >= 0 && list[state.sel]) {
      e.preventDefault(); openResult(list[state.sel].url); return
    }
    if (!inInput && /^[1-9]$/.test(e.key) && list[Number(e.key) - 1]) {
      e.preventDefault(); openResult(list[Number(e.key) - 1].url); return
    }
    if (e.key === '/' && !inInput) { e.preventDefault(); $('q').focus(); $('q').select() }
  })

  $('go').addEventListener('click', function () { run($('q').value.trim()) })
  $('clear').addEventListener('click', function () {
    $('q').value = ''; $('clear').style.display = 'none'
    $('hint').style.display = 'none'; $('instant').style.display = 'none'; hideSugg(); $('q').focus()
  })
  $('q').addEventListener('input', livePreview)
  $('q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggOpen && suggSel >= 0) pickSugg(suggList[suggSel])
      else { hideSugg(); run($('q').value.trim()) }
    }
  })
  document.addEventListener('click', function (e) {
    if (suggOpen && !$('sugg').contains(e.target) && e.target !== $('q')) hideSugg()
  })

  var params = new URLSearchParams(location.search)
  var q0 = params.get('q')
  if (q0 && q0.trim()) run(q0.trim())
  else { renderTry(); $('q').focus() }
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
  .action-btn { padding:9px 16px; font-size:12.5px; color:var(--ax-accent); background:var(--ax-accent-soft);
    border:1px solid var(--ax-accent); border-radius:10px; cursor:pointer; font-weight:600; }
  .action-btn:hover { filter:brightness(1.15); }
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

function mgrShell(title: string, heading: string, withClear: boolean, body: string, script: string, withDomain = false, extraHead = ''): string {
  const clearBtn = withClear ? '<button class="muted-btn" id="clear">Clear all</button>' : ''
  const domainSel = withDomain ? '<select id="domain" style="max-width:180px"><option value="">All sites</option></select>' : ''
  const count = '<span id="count" style="font-size:11.5px;color:var(--ax-muted);align-self:center"></span>'
  return pageShell(
    title,
    `
    <div class="wrap">
      <div class="head">
        <h1>${heading}</h1>
        ${domainSel}
        <input id="q" type="text" placeholder="Search…" />
        ${count}
        ${extraHead}
        ${clearBtn}
      </div>
      <div class="rows" id="rows"></div>
      <div class="empty2" id="empty" style="display:none">Nothing here yet.</div>
    </div>
    <style>${MGR_CSS}
    .day-head { padding:14px 4px 6px; font-size:12px; font-weight:700; letter-spacing:.05em; color:var(--ax-muted); text-transform:uppercase; border-bottom:1px solid var(--ax-border); margin-bottom:4px; }
    </style>
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
  function dayLabel(ts) {
    var d = new Date(ts), today = new Date(), y = new Date(today.getTime() - 86400000)
    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === y.toDateString()) return 'Yesterday'
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  }
  var current = []
  var currentDomain = ''
  function domainOptions(items) {
    var freq = {}
    items.forEach(function (h) { freq[h.host] = (freq[h.host] || 0) + 1 })
    return Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a] })
  }
  function renderDomainPicker(items) {
    var sel = document.getElementById('domain')
    sel.innerHTML = ''
    var all = document.createElement('option'); all.value = ''; all.textContent = 'All sites'; sel.appendChild(all)
    domainOptions(items).forEach(function (h) {
      var o = document.createElement('option'); o.value = h; o.textContent = h.replace(/^www\\./, ''); sel.appendChild(o)
    })
    sel.value = currentDomain
    if (currentDomain && !domainOptions(items).includes(currentDomain)) { currentDomain = ''; sel.value = '' }
  }
  function render(items) {
    current = items
    renderDomainPicker(items)
    var rows = document.getElementById('rows')
    rows.innerHTML = ''
    var visible = currentDomain ? items.filter(function (h) { return h.host === currentDomain }) : items
    document.getElementById('empty').style.display = visible.length ? 'none' : 'block'
    document.getElementById('count').textContent = visible.length
      ? visible.length + ' page' + (visible.length === 1 ? '' : 's')
      : ''
    var lastDay = ''
    visible.forEach(function (h) {
      var dl = dayLabel(h.ts)
      if (dl !== lastDay) {
        lastDay = dl
        var head = document.createElement('div'); head.className = 'day-head'
        head.textContent = dl
        rows.appendChild(head)
      }
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
  document.getElementById('domain').addEventListener('change', function (e) {
    currentDomain = e.target.value || ''
    render(current)
  })
  document.getElementById('clear').addEventListener('click', function () {
    if (confirm('Clear ALL browsing history?')) { window.aether.history.clear(); render([]) }
  })
  // semantic history (#73) — "find that article about…" via local embeddings
  var semBtn = document.createElement('button')
  semBtn.className = 'muted-btn'
  semBtn.textContent = 'Find that article…'
  semBtn.title = 'Semantic search — describe what you remember; needs an Ollama embedding model'
  document.getElementById('clear').parentNode.insertBefore(semBtn, document.getElementById('clear'))
  semBtn.addEventListener('click', function () {
    var q = document.getElementById('q').value.trim()
    if (!q) return
    semBtn.disabled = true
    semBtn.textContent = 'Thinking locally…'
    window.aether.ai2.semSearch(q).then(function (res) {
      semBtn.disabled = false
      semBtn.textContent = 'Find that article…'
      if (!res || !res.ok) {
        document.getElementById('empty').style.display = 'block'
        document.getElementById('empty').textContent = (res && res.error) || 'Semantic search unavailable.'
        return
      }
      document.getElementById('empty').style.display = 'none'
      var rows = document.getElementById('rows')
      rows.innerHTML = ''
      var head = document.createElement('div'); head.className = 'day-head'
      head.textContent = 'Semantically closest to “' + q + '”' + (res.model ? ' · ' + res.model : '')
      rows.appendChild(head)
      if (!res.results || !res.results.length) {
        document.getElementById('empty').style.display = 'block'
        document.getElementById('empty').textContent = 'Nothing close enough. Browse more or try different words.'
        return
      }
      res.results.forEach(function (r) {
        var row = document.createElement('div'); row.className = 'row'
        var ic = document.createElement('div'); ic.className = 'ic none'; ic.textContent = '~'
        var meta = document.createElement('div'); meta.className = 'meta'
        var t = esc(r.item.title); t.className = 't'
        var u = esc(r.item.url); u.className = 'u'
        meta.appendChild(t); meta.appendChild(u)
        var w = document.createElement('div'); w.className = 'when'; w.textContent = Math.round(r.score * 100) + '%'
        row.appendChild(ic); row.appendChild(meta); row.appendChild(w)
        row.addEventListener('click', function () { window.aether.internal.open(r.item.url) })
        rows.appendChild(row)
      })
    }).catch(function () {
      semBtn.disabled = false
      semBtn.textContent = 'Find that article…'
    })
  })
  load()
  `,
  true
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

export const READINGLIST_HTML = mgrShell(
  'Reading list',
  'Reading list',
  false,
  '',
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  var current = []
  var showRead = true
  function render() {
    var rows = document.getElementById('rows')
    rows.innerHTML = ''
    var items = showRead ? current : current.filter(function (x) { return !x.read })
    document.getElementById('empty').style.display = items.length ? 'none' : 'block'
    document.getElementById('count').textContent = items.length
      ? items.length + ' page' + (items.length === 1 ? '' : 's') +
        ' · ' + items.filter(function (x) { return !x.read }).length + ' unread'
      : ''
    items.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'row' + (it.read ? ' read' : '')
      var ic = document.createElement('div'); ic.className = 'ic none'
      ic.textContent = it.read ? '\\u2713' : '\\u2022'
      var meta = document.createElement('div'); meta.className = 'meta'
      var t = esc(it.title || it.url); t.className = 't'
      var u = esc((it.url || '').replace(/^https?:\\/\\//, '').split('/')[0])
      u.className = 'u'
      var mins = document.createElement('span'); mins.className = 'mins'
      mins.textContent = it.minutes ? it.minutes + ' min read' : ''
      mins.style.cssText = 'font-size:10.5px;color:var(--ax-muted);margin-left:8px'
      meta.appendChild(t); meta.appendChild(u); if (it.minutes) meta.appendChild(mins)
      var done = document.createElement('button'); done.className = 'muted-btn'; done.style.fontSize = '11px'
      done.textContent = it.read ? 'Unread' : 'Read'
      done.addEventListener('click', function (e) {
        e.stopPropagation()
        window.aether.reading.toggleRead(it.url).then(function (l) { current = l; render() })
      })
      var del = document.createElement('button'); del.className = 'del'; del.textContent = '\\u00d7'
      del.title = 'Remove'
      del.addEventListener('click', function (e) {
        e.stopPropagation()
        window.aether.reading.remove(it.url).then(function (l) { current = l; render() })
      })
      row.appendChild(ic); row.appendChild(meta); row.appendChild(done); row.appendChild(del)
      row.addEventListener('click', function () { window.aether.internal.open(it.url) })
      rows.appendChild(row)
    })
  }
  document.getElementById('showread').addEventListener('change', function (e) {
    showRead = !e.target.checked
    render()
  })
  window.aether.reading.list().then(function (l) { current = l || []; render() })
  `,
  false,
  '<label style="font-size:11.5px;color:var(--ax-muted);display:flex;align-items:center;gap:5px"><input type="checkbox" id="showread" /> Hide read</label>'
)

export const DOWNLOADS_HTML = mgrShell(
  'Downloads',
  'Downloads',
  true,
  '',
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  function fmtBytes(n) {
    if (n == null || isNaN(n) || n <= 0) return ''
    if (n < 1024) return n + ' B'
    var u = ['KB', 'MB', 'GB'], i = -1
    do { n = n / 1024; i++ } while (n >= 1024 && i < 2)
    return (n >= 10 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i]
  }
  function when(ts) {
    var d = new Date(ts), today = new Date()
    var hm = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes()
    if (d.toDateString() === today.toDateString()) return hm
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm
  }
  function ext(name) { var i = String(name).lastIndexOf('.'); return i > 0 ? String(name).slice(i + 1, i + 5).toUpperCase() : 'FILE' }
  var view = { active: [], history: [] }
  function rows() {
    var q = document.getElementById('q').value.trim().toLowerCase()
    function hit(name) { return !q || String(name).toLowerCase().indexOf(q) >= 0 }
    var act = view.active.filter(function (a) { return hit(a.filename) })
    var his = view.history.filter(function (h) { return hit(h.filename) })
    return act.concat(his)
  }
  function subLine(x) {
    if (x.state === 'progressing') {
      if (x.paused) return 'Paused — ' + fmtBytes(x.received)
      var pct = x.percent == null ? '' : ' (' + x.percent + '%)'
      return fmtBytes(x.received) + (x.total ? ' of ' + fmtBytes(x.total) : '') + pct
    }
    if (x.state === 'cancelled') return 'Cancelled' + (x.total ? ' · ' + fmtBytes(x.total) : '')
    if (x.state === 'interrupted') return 'Failed' + (x.total ? ' · ' + fmtBytes(x.total) : '')
    return 'Completed' + (x.total ? ' · ' + fmtBytes(x.total) : '')
  }
  function render() {
    var items = rows()
    var box = document.getElementById('rows')
    box.innerHTML = ''
    document.getElementById('empty').style.display = items.length ? 'none' : 'block'
    document.getElementById('empty').textContent = items.length ? '' : 'No downloads yet.'
    items.forEach(function (x) {
      var isLive = x.state === 'progressing'
      var row = document.createElement('div'); row.className = 'row'
      var ic = document.createElement('div'); ic.className = 'ic none'
      ic.textContent = ext(x.filename)
      var meta = document.createElement('div'); meta.className = 'meta'
      var t = esc(x.filename); t.className = 't'
      var u = esc(subLine(x)); u.className = 'u'
      meta.appendChild(t); meta.appendChild(u)
      var w = document.createElement('div'); w.className = 'when'; w.textContent = when(x.ts)

      var btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:4px;flex:none'
      function mkBtn(label, title, fn) {
        var b = document.createElement('button'); b.className = 'del'; b.textContent = label; b.title = title
        b.addEventListener('click', function (e) { e.stopPropagation(); fn() })
        btns.appendChild(b)
      }
      if (isLive) {
        if (x.paused) mkBtn('\\u25b6', 'Resume download', function () { window.aether.downloads.resume(x.id); load() })
        else mkBtn('\\u23f8', 'Pause download', function () { window.aether.downloads.pause(x.id); load() })
        mkBtn('\\u00d7', 'Cancel download', function () { window.aether.downloads.cancel(x.id); load() })
      } else {
        mkBtn('\\u21bb', 'Download again', function () { window.aether.downloads.redownload(x.id) })
        mkBtn('\\u00d7', 'Remove from list (keeps the file)', function () {
          window.aether.downloads.removeRecord(x.id).then(load)
        })
      }
      row.appendChild(ic); row.appendChild(meta); row.appendChild(w); row.appendChild(btns)
      row.title = x.path || x.url || ''
      row.addEventListener('click', function () {
        if (x.state === 'progressing') return
        window.aether.downloads.reveal(x.path)
      })
      box.appendChild(row)
    })
  }
  function apply(d) {
    if (!d) return
    view = { active: d.active || [], history: d.history || [] }
    render()
  }
  function load() { window.aether.downloads.list().then(apply).catch(function () {}) }
  document.getElementById('q').addEventListener('input', render)
  document.getElementById('clear').addEventListener('click', function () {
    if (confirm('Clear the download list? Files on disk are kept.')) { window.aether.downloads.clear().then(load) }
  })
  try { window.aether.downloads.onChanged(function () { load() }) } catch (e) {}
  load()
  `
)

export const PASSWORDS_HTML = mgrShell(
  'Passwords',
  'Passwords',
  false,
  `
  <div id="keywarn" style="display:none; margin-bottom:14px; padding:11px 14px; background:var(--ax-danger-bg); border:1px solid var(--ax-danger-border);
    border-radius:10px; color:var(--ax-danger); font-size:12.5px; line-height:1.5"></div>
  <div id="addpanel" style="display:none; margin-bottom:18px; padding:14px 16px; background:var(--ax-card2);
    border:1px solid var(--ax-border); border-radius:12px">
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
      <input id="addUrl" placeholder="https://example.com" style="flex:2 1 220px; padding:10px 12px; font-size:13px; color:var(--ax-fg);
        background:var(--ax-card); border:1px solid var(--ax-border); border-radius:10px; outline:none" />
      <input id="addUser" placeholder="username or email" style="flex:2 1 180px; padding:10px 12px; font-size:13px; color:var(--ax-fg);
        background:var(--ax-card); border:1px solid var(--ax-border); border-radius:10px; outline:none" />
      <input id="addPass" type="password" placeholder="password" style="flex:2 1 180px; padding:10px 12px; font-size:13px; color:var(--ax-fg);
        background:var(--ax-card); border:1px solid var(--ax-border); border-radius:10px; outline:none" />
    </div>
    <div style="display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap">
      <button class="save-btn" id="addSave">Save login</button>
      <button class="muted-btn" id="addGen" style="color:var(--ax-accent)">Generate strong password</button>
      <button class="muted-btn" id="addCancel" style="color:var(--ax-muted2)">Cancel</button>
      <span id="addStrength" style="font-size:11.5px; color:var(--ax-muted)"></span>
      <span id="addMsg" style="font-size:11.5px; color:var(--ax-danger)"></span>
    </div>
  </div>
  <div id="blockedWrap" style="display:none; margin-top:26px">
    <div style="color:var(--ax-muted); font-size:12px; letter-spacing:.1em; margin-bottom:10px">NEVER SAVE ON THESE SITES</div>
    <div class="rows" id="blockedRows"></div>
  </div>
  `,
  `
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d }
  var state = { records: [], blocked: [], available: true }
  var addBtn = document.createElement('button')
  addBtn.className = 'action-btn'
  addBtn.textContent = 'Add login'
  var head = document.querySelector('.head')
  if (head) head.appendChild(addBtn)
  var warn = document.getElementById('keywarn')

  function copyText(text, okMsg) {
    var done = function () { flash(okMsg) }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text); done() })
    } else { legacyCopy(text); done() }
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    } catch (err) { /* best effort */ }
  }
  var flashTimer = null
  function flash(msg) {
    var el = document.getElementById('count')
    if (!el) return
    el.textContent = msg
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(function () { render() }, 2500)
  }
  function strengthChip(v) {
    var span = document.createElement('span')
    var labels = ['very weak', 'weak', 'fair', 'strong', 'excellent']
    var colors = ['var(--ax-danger)', 'var(--ax-danger)', 'var(--ax-warn, #d9a441)', 'var(--ax-ok)', 'var(--ax-ok)']
    span.textContent = labels[Math.max(0, Math.min(4, v || 0))]
    span.style.cssText = 'flex:none;font-size:10.5px;color:' + colors[Math.max(0, Math.min(4, v || 0))] +
      ';border:1px solid currentColor;border-radius:7px;padding:2px 7px'
    return span
  }
  function render() {
    var q = document.getElementById('q').value.trim().toLowerCase()
    var rows = document.getElementById('rows')
    rows.innerHTML = ''
    var visible = state.records.filter(function (r) {
      if (!q) return true
      return (r.host + ' ' + r.username).toLowerCase().indexOf(q) >= 0
    })
    document.getElementById('empty').style.display = visible.length ? 'none' : 'block'
    document.getElementById('empty').textContent = state.records.length
      ? 'No logins match “' + q + '”.'
      : 'No saved logins yet. Aether offers to save when you sign in — or use Add login.'
    document.getElementById('count').textContent = state.records.length
      ? state.records.length + ' login' + (state.records.length === 1 ? '' : 's') : ''
    visible.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'row'
      var ic = document.createElement('div'); ic.className = 'ic none'
      ic.textContent = (r.host || '?').replace(/^www\\./, '').charAt(0).toUpperCase()
      var meta = document.createElement('div'); meta.className = 'meta'
      var t = esc(r.username || '(no username)'); t.className = 't'
      var u = esc(r.host); u.className = 'u'
      meta.appendChild(t); meta.appendChild(u)
      var copy = document.createElement('button')
      copy.className = 'muted-btn'; copy.style.fontSize = '11px'; copy.style.color = 'var(--ax-accent)'
      copy.textContent = 'Copy password'
      copy.title = 'Decrypts with the OS keychain and copies'
      copy.addEventListener('click', function (e) {
        e.stopPropagation()
        window.aether.creds.reveal(r.id).then(function (pw) {
          if (!pw) { flash('could not decrypt'); return }
          copyText(pw, 'password copied — paste it, then clear your clipboard')
        }).catch(function () { flash('could not decrypt') })
      })
      var del = document.createElement('button'); del.className = 'del'; del.textContent = '\\u00d7'
      del.title = 'Delete saved login'
      del.addEventListener('click', function (e) {
        e.stopPropagation()
        window.aether.creds.remove(r.id).then(load)
      })
      row.appendChild(ic); row.appendChild(meta); row.appendChild(strengthChip(r.strong)); row.appendChild(copy); row.appendChild(del)
      rows.appendChild(row)
    })
    var bwrap = document.getElementById('blockedWrap')
    var brows = document.getElementById('blockedRows')
    brows.innerHTML = ''
    bwrap.style.display = state.blocked.length ? 'block' : 'none'
    state.blocked.forEach(function (host) {
      var row = document.createElement('div'); row.className = 'row'
      var ic = document.createElement('div'); ic.className = 'ic none'; ic.textContent = '\\u00d7'
      var meta = document.createElement('div'); meta.className = 'meta'
      var t = esc(host); t.className = 't'
      var u = document.createElement('div'); u.className = 'u'
      u.textContent = 'Aether will never offer to save logins here'
      meta.appendChild(t); meta.appendChild(u)
      var un = document.createElement('button')
      un.className = 'muted-btn'; un.style.fontSize = '11px'
      un.textContent = 'Allow again'
      un.addEventListener('click', function () { window.aether.creds.unblock(host).then(load) })
      row.appendChild(ic); row.appendChild(meta); row.appendChild(un)
      brows.appendChild(row)
    })
  }
  function load() {
    window.aether.creds.list().then(function (v) {
      state.records = v.records || []
      state.blocked = v.blocked || []
      state.available = v.available !== false
      warn.style.display = state.available ? 'none' : 'block'
      warn.textContent = 'The OS keychain is unavailable, so password saving is disabled on this system. ' +
        'Aether refuses to store passwords unencrypted — enable a keyring service (Windows: automatic, macOS: automatic, Linux: gnome-keyring or kwallet) and reopen this page.'
      render()
    }).catch(function () { /* bridge down */ })
  }
  document.getElementById('q').addEventListener('input', render)
  addBtn.addEventListener('click', function () {
    var p = document.getElementById('addpanel')
    p.style.display = p.style.display === 'none' ? 'block' : 'none'
    document.getElementById('addMsg').textContent = ''
  })
  document.getElementById('addCancel').addEventListener('click', function () {
    document.getElementById('addpanel').style.display = 'none'
  })
  document.getElementById('addPass').addEventListener('input', function (e) {
    var v = e.target.value || ''
    var score = 0
    if (v.length >= 8) score = 1
    if (v.length >= 10 && (/[^A-Za-z0-9]/.test(v) || /[A-Z]/.test(v)) && /[0-9]/.test(v)) score = 2
    if (v.length >= 12 && /[^A-Za-z0-9]/.test(v) && /[0-9]/.test(v) && /[A-Z]/.test(v)) score = 3
    if (v.length >= 16 && /[^A-Za-z0-9]/.test(v) && /[0-9]/.test(v) && /[A-Z]/.test(v)) score = 4
    var labels = ['very weak', 'weak', 'fair', 'strong', 'excellent']
    document.getElementById('addStrength').textContent = v ? 'strength: ' + labels[score] : ''
  })
  document.getElementById('addGen').addEventListener('click', function () {
    var pools = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*()-_=+[]{};:,.?']
    var all = pools.join('')
    var out = []
    for (var i = 0; i < pools.length; i++) {
      var arr = new Uint32Array(1); window.crypto.getRandomValues(arr)
      out.push(pools[i][arr[0] % pools[i].length])
    }
    while (out.length < 20) {
      var arr2 = new Uint32Array(1); window.crypto.getRandomValues(arr2)
      out.push(all[arr2[0] % all.length])
    }
    for (var j = out.length - 1; j > 0; j--) {
      var arr3 = new Uint32Array(1); window.crypto.getRandomValues(arr3)
      var k = arr3[0] % (j + 1)
      var tmp = out[j]; out[j] = out[k]; out[k] = tmp
    }
    var field = document.getElementById('addPass')
    field.value = out.join('')
    field.dispatchEvent(new Event('input'))
  })
  document.getElementById('addSave').addEventListener('click', function () {
    var url = document.getElementById('addUrl').value.trim()
    var user = document.getElementById('addUser').value
    var pass = document.getElementById('addPass').value
    window.aether.creds.add(url, user, pass).then(function (res) {
      if (!res || !res.ok) {
        document.getElementById('addMsg').textContent = (res && res.error) || 'could not save'
        return
      }
      document.getElementById('addpanel').style.display = 'none'
      document.getElementById('addUrl').value = ''
      document.getElementById('addUser').value = ''
      document.getElementById('addPass').value = ''
      document.getElementById('addStrength').textContent = ''
      load()
    }).catch(function () { document.getElementById('addMsg').textContent = 'could not save' })
  })
  load()
  `
)

export const PRIVACY_HTML = pageShell(
  'AI privacy pledge',
  `
  <style>
    .pl { max-width: 640px; margin: 40px auto; padding: 0 20px; }
    .pl h1 { font-size: 26px; font-weight: 300; margin-bottom: 6px; }
    .pl .sub { color: var(--ax-muted); font-size: 13px; margin-bottom: 24px; }
    .pl .claim { display: flex; gap: 12px; padding: 14px 16px; background: var(--ax-card); border: 1px solid var(--ax-border);
      border-radius: 12px; margin-bottom: 10px; font-size: 13.5px; line-height: 1.55; }
    .pl .claim .tick { color: var(--ax-ok); font-weight: 700; flex: none; }
    .pl .claim b { display: block; margin-bottom: 2px; }
    .pl .claim span.d { color: var(--ax-muted); font-size: 12.5px; }
  </style>
  <div class="pl">
    <h1>AI privacy pledge</h1>
    <div class="sub">What Aether does with your data — every claim below is enforced in code, in this repository (GPL-3.0, auditable).</div>
    <div class="claim"><span class="tick">✓</span><div><b>Your browsing history never leaves this device.</b><span class="d">History is written to one JSON file in your profile folder. There is no sync, no account, no telemetry endpoint in the codebase.</span></div></div>
    <div class="claim"><span class="tick">✓</span><div><b>AI chat, summaries and search answers run on YOUR machine.</b><span class="d">Chat, TL;DR and cited answers call your local Ollama at 127.0.0.1:11434. Nothing else can reach them.</span></div></div>
    <div class="claim"><span class="tick">✓</span><div><b>Search result snippets come from the open web; answers are composed locally.</b><span class="d">Aether fetches public search HTML (DuckDuckGo/Bing/Wikipedia/Mojeek), then your local model writes the answer.</span></div></div>
    <div class="claim"><span class="tick">✓</span><div><b>Agent actions run in this browser, under your approval.</b><span class="d">The agent can only drive tabs you can see, and asks before every write action when confirmation is enabled (default).</span></div></div>
    <div class="claim"><span class="tick">✓</span><div><b>Cloud fallback is opt-in and never automatic.</b><span class="d">Only if you enable it in Settings and paste your own key — and even then only chat messages you send go to that endpoint.</span></div></div>
    <div class="claim"><span class="tick">✓</span><div><b>Semantic history embeddings stay local.</b><span class="d">"Find that article" vectors are computed by your local embedding model and cached on disk in your profile.</span></div></div>
    <div class="claim"><span class="tick">✓</span><div><b>Blocked trackers stay blocked.</b><span class="d">EasyList + EasyPrivacy + your lists are enforced by the shields engine before requests leave the machine.</span></div></div>
  </div>
  `,
  ''
)

export const SETTINGS_HTML = pageShell(
  'Settings',
  `
  <div class="wrap" style="width:min(620px,92vw)">
    <div class="head"><h1>Settings</h1><span id="health" style="font-size:12px;color:var(--ax-muted2)"></span></div>

    <div class="sec" id="default-browser-sec">
      <div class="label">Default browser</div>
      <div id="db-status" class="hint" style="margin-bottom:10px">Checking whether links open in Aether…</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button id="db-set" class="action-btn" style="display:none">Make Aether my default browser</button>
        <button id="db-open" class="muted-btn" style="display:none;color:var(--ax-fg);border-color:var(--ax-border)">Open system settings</button>
      </div>
      <div class="hint" style="margin-top:10px">Once Aether is the default, every link you click anywhere on this computer opens here — and stays on this machine.</div>
    </div>

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
      <div style="display:flex; align-items:center; gap:10px; margin-top:10px">
        <label style="font-size:13px; color:var(--ax-fg)">AI search depth</label>
        <select id="searchDepth" style="width:170px">
          <option value="quick">Quick — concise, cited</option>
          <option value="deep">Deep — thorough synthesis</option>
          <option value="academic">Academic — sourced review</option>
          <option value="code">Code — docs &amp; fixes</option>
        </select>
        <a href="#" id="pledgeLink" style="font-size:11.5px; color:var(--ax-accent)">AI privacy pledge →</a>
      </div>
      <div style="display:flex; align-items:center; gap:10px; margin-top:8px">
        <label style="font-size:13px; color:var(--ax-fg)">TL;DR on load for</label>
        <input id="tldrHosts" type="text" placeholder="en.wikipedia.org, docs.python.org" style="flex:1" />
      </div>
      <div class="hint" style="margin-top:5px">Pages from these sites get an automatic 3-bullet summary from your local model (bottom-right toast). Empty = off.</div>
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
        <div style="display:flex; align-items:center; gap:10px; margin-top:4px">
          <label style="font-size:13px; color:var(--ax-fg)">Tab strip</label>
          <select id="tabOrientation" style="width:160px">
            <option value="top">Top — classic horizontal strip</option>
            <option value="left">Left — vertical panel with groups</option>
          </select>
        </div>
        <div style="display:flex; align-items:center; gap:10px; margin-top:8px">
          <label style="font-size:13px; color:var(--ax-fg)">Force dark</label>
          <select id="fdMode" style="width:210px">
            <option value="off">Off</option>
            <option value="always">Always — for the listed sites</option>
            <option value="night">Night only — 20:00 to 07:00</option>
          </select>
          <input id="fdHosts" type="text" placeholder="example.com, news.org" style="flex:1" />
        </div>
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
        <label><input type="checkbox" id="showBookmarksBar" /> Show the bookmarks bar (Ctrl+Shift+B)</label>
        <label><input type="checkbox" id="spellcheck" /> Check spelling in form fields (en-US, right-click for fixes)</label>
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
      <div class="label" style="margin-top:18px">Site permissions</div>
      <div style="display:flex; align-items:center; gap:10px; margin-top:8px">
        <label style="font-size:13px; color:var(--ax-fg)">Re-ask for camera, mic, location… after</label>
        <select id="grantTtl" style="width:140px">
          <option value="0">Never re-ask</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="180">180 days (recommended)</option>
          <option value="365">1 year</option>
        </select>
      </div>
      <div class="hint" style="margin-top:6px">Remembered grants quietly expire after this idle time — the next visit prompts again (Master Plan #13).</div>
      <div class="label" style="margin-top:18px">Privacy fortress</div>
      <div class="opts" style="margin-top:6px">
        <label><input type="checkbox" id="paramScrubber" /> Strip tracking parameters from addresses (utm_*, gclid, fbclid…)</label>
        <label><input type="checkbox" id="referrerTight" /> Only tell sites the bare origin when you follow an outside link</label>
        <label><input type="checkbox" id="httpsOnly" /> HTTPS-only mode — upgrade http:// addresses automatically (localhost never touched)</label>
      </div>
      <div style="display:flex; gap:10px; margin-top:8px">
        <select id="dohMode" style="width:190px">
          <option value="off">DNS: default (your provider)</option>
          <option value="auto">DNS-over-HTTPS: auto (fallback allowed)</option>
          <option value="secure">DNS-over-HTTPS: secure (no fallback)</option>
        </select>
        <select id="dohPreset" style="width:170px">
          <option value="">Provider: choose…</option>
          <option value="https://cloudflare-dns.com/dns-query">Cloudflare</option>
          <option value="https://dns.quad9.net/dns-query">Quad9</option>
          <option value="https://dns.google/dns-query">Google</option>
        </select>
        <input id="dohCustom" type="url" placeholder="or custom template URL" style="flex:1" />
      </div>
      <div class="hint" style="margin-top:6px">DoH changes apply after a restart of Aether. In secure mode a provider is required (defaults to Cloudflare).</div>
      <div class="label" style="margin-top:16px">Clear browsing data</div>
      <div class="opts" style="margin-top:6px">
        <label style="display:inline-flex; margin-right:14px"><input type="checkbox" id="cdHistory" checked /> Browsing history</label>
        <label style="display:inline-flex; margin-right:14px"><input type="checkbox" id="cdCookies" /> Cookies &amp; logins</label>
        <label style="display:inline-flex; margin-right:14px"><input type="checkbox" id="cdCache" /> Cached files</label>
        <label style="display:inline-flex"><input type="checkbox" id="cdSiteData" /> Site storage</label>
      </div>
      <div style="display:flex; gap:8px; margin-top:8px; align-items:center">
        <select id="cdRange" style="width:140px">
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="4w">Last 4 weeks</option>
          <option value="all" selected>All time</option>
        </select>
        <button class="save-btn" id="cdGo">Clear data</button>
        <span id="cdStatus" style="font-size:11.5px;color:var(--ax-ok);align-self:center"></span>
      </div>
      <div class="label" style="margin-top:18px">Certificate exceptions</div>
      <div class="hint" style="margin-bottom:8px">Sites you chose “Proceed anyway” on are remembered for 24 hours, for that exact certificate only. There is no permanent bypass.</div>
      <button class="muted-btn" id="certForget">Forget remembered certificate exceptions</button>
      <div class="label" style="margin-top:18px">External apps</div>
      <div class="hint" style="margin-bottom:8px">When a site hands off a mailto:, magnet: or meeting link, Aether asks before launching the app — with an optional “remember my choice” per link type.</div>
      <button class="muted-btn" id="extprotoForget">Reset remembered app-launch choices</button>
      <div class="label" style="margin-top:18px">OS integration</div>
      <div class="opts" style="margin-top:6px">
        <label><input type="checkbox" id="showTray" /> Show the quick-actions tray icon (new tab, private window, pause shields)</label>
        <label><input type="checkbox" id="closeToTray" /> Closing the window keeps Aether running in the tray</label>
        <label><input type="checkbox" id="startupBoost" /> Startup boost — start with my computer (hidden, for a warm first link)</label>
        <label><input type="checkbox" id="notifyDownloads" /> Notify me when a download completes</label>
      </div>
    </div>

    <div class="sec">
      <div class="label">Downloads</div>
      <div class="opts" style="margin-top:6px">
        <label><input type="checkbox" id="askDownloadLocation" /> Ask where to save each file before downloading</label>
      </div>
      <div class="row-btns" style="margin-top:10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap">
        <button class="muted-btn" id="dlChoose">Change download location…</button>
        <span id="dlDir" style="font-size:11.5px;color:var(--ax-muted2)"></span>
      </div>
    </div>

    <div class="sec">
      <div class="label">Passwords</div>
      <div class="opts" style="margin-top:6px">
        <label><input type="checkbox" id="pmEnabled" /> Offer to save passwords and let me fill them (vault stays encrypted with the OS keychain — nothing leaves this device)</label>
      </div>
      <div class="row-btns" style="margin-top:10px">
        <button class="save-btn" id="pmOpen">Open password manager…</button>
      </div>
    </div>

    <div class="sec">
      <div class="label">Web apps</div>
      <div class="hint" style="margin-bottom:10px">Install any site as its own desktop app — it opens in a dedicated window without browser chrome, keeps your logins, and shows up in the Start-menu jump list / dock. Right-click any page → “Install … as app”.</div>
      <div id="appsList" style="display:flex; flex-direction:column; gap:6px"></div>
      <div id="appsEmpty" style="display:none; font-size:12px; color:var(--ax-faint); padding:6px 2px">No web apps installed yet.</div>
    </div>

    <div class="sec">
      <div class="label">Profiles</div>
      <div class="hint" style="margin-bottom:10px">Profiles keep completely separate history, bookmarks, passwords, cookies, extensions and settings — work and life never mix. Switching flushes this session and relaunches Aether into the other profile; two profiles can also run side by side. The default “Personal” profile keeps your existing data and cannot be deleted.</div>
      <div id="profList" style="display:flex; flex-direction:column; gap:6px"></div>
      <div class="row-btns" style="margin-top:10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap">
        <input id="profName" type="text" placeholder="New profile name" style="width:180px" />
        <select id="profColor" style="width:70px"></select>
        <button class="save-btn" id="profAdd">Create profile</button>
        <span id="profMsg" style="font-size:11.5px;color:var(--ax-muted2);align-self:center"></span>
      </div>
    </div>

    <div class="sec">
      <div class="label">Import &amp; export</div>
      <div class="hint" style="margin-bottom:10px">Bring your bookmarks from Chrome, Edge, Brave or Chromium on this machine in one click, or import any browser’s exported bookmarks HTML file. Export writes the universal format every browser understands.</div>
      <div id="impSrc" style="display:flex; flex-direction:column; gap:6px"></div>
      <div class="row-btns" style="margin-top:10px">
        <button class="save-btn" id="impFile">Import bookmarks from file…</button>
        <button class="muted-btn" id="bmExport">Export bookmarks…</button>
        <span id="impMsg" style="font-size:11.5px;color:var(--ax-muted2);align-self:center"></span>
      </div>
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
  // --- default browser card ------------------------------------------------
  function renderDefaultBrowser(st) {
    var status = document.getElementById('db-status')
    var setBtn = document.getElementById('db-set')
    var openBtn = document.getElementById('db-open')
    if (!st || typeof st.isDefault !== 'boolean') {
      status.textContent = 'Could not check the system default browser.'
      return
    }
    if (st.isDefault) {
      status.textContent = '✓ Aether is your default browser — links everywhere open here.'
      status.style.color = 'var(--ax-ok)'
      setBtn.style.display = 'none'
      openBtn.style.display = 'none'
    } else {
      var who = st.handler ? 'Currently links open in: ' + st.handler.split(/[\\\\/]/).pop() : 'Currently another browser handles your links.'
      status.textContent = who + ' Make links open in Aether instead?'
      status.style.color = 'var(--ax-muted)'
      setBtn.style.display = ''
      openBtn.style.display = ''
    }
  }
  try {
    window.aether.internal.defaultBrowser().then(renderDefaultBrowser).catch(function () {
      document.getElementById('db-status').textContent = 'Could not check the system default browser.'
    })
    document.getElementById('db-set').addEventListener('click', function () {
      window.aether.internal.setDefaultBrowser().then(renderDefaultBrowser).catch(function () {})
    })
    document.getElementById('db-open').addEventListener('click', function () {
      try { window.aether.internal.openSystemSettings() } catch (e) {}
    })
  } catch (e) {}

  function load() {
    window.aether.settings.get().then(function (s) {
      document.getElementById('model').value = s.model || ''
      var radios = document.querySelectorAll('input[name=sm]')
      for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === s.searchMode
      document.getElementById('searchDepth').value = s.searchDepth || 'quick'
      document.getElementById('tldrHosts').value = Array.isArray(s.tldrHosts) ? s.tldrHosts.join(', ') : ''
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
      document.getElementById('tabOrientation').value = s.tabOrientation === 'left' ? 'left' : 'top'
      document.getElementById('fdMode').value = s.forceDarkMode || 'off'
      document.getElementById('fdHosts').value = Array.isArray(s.forceDarkHosts) ? s.forceDarkHosts.join(', ') : ''
      document.getElementById('paramScrubber').checked = s.paramScrubber !== false
      document.getElementById('referrerTight').checked = s.referrerTight !== false
      document.getElementById('httpsOnly').checked = s.httpsOnly === true
      document.getElementById('dohMode').value = s.dohMode || 'off'
      var dtpl = s.dohTemplate || ''
      var presetSel = document.getElementById('dohPreset')
      var known = ['https://cloudflare-dns.com/dns-query', 'https://dns.quad9.net/dns-query', 'https://dns.google/dns-query']
      if (known.includes(dtpl)) { presetSel.value = dtpl; document.getElementById('dohCustom').value = '' }
      else { presetSel.value = ''; document.getElementById('dohCustom').value = dtpl }
      axWire(); axMarkSwatch()
      document.getElementById('confirmAgentActions').checked = !!s.confirmAgentActions
      document.getElementById('showBookmarksBar').checked = s.showBookmarksBar !== false
      document.getElementById('usePageContext').checked = !!s.usePageContext
      document.getElementById('pageMemory').checked = s.pageMemory !== false
      document.getElementById('adblock').checked = !!s.adblock
      document.getElementById('shieldsAggressive').checked = !!s.shieldsAggressive
      document.getElementById('stripElectronUA').checked = !!s.stripElectronUA
      document.getElementById('memorySaver').value = String(s.memorySaver || 0)
      document.getElementById('grantTtl').value = String(s.grantTtlDays ?? 180)
      document.getElementById('showTray').checked = s.showTray !== false
      document.getElementById('closeToTray').checked = !!s.closeToTray
      document.getElementById('startupBoost').checked = !!s.startupBoost
      document.getElementById('notifyDownloads').checked = s.notifyDownloads !== false
      document.getElementById('spellcheck').checked = s.spellcheck !== false
      document.getElementById('askDownloadLocation').checked = !!s.askDownloadLocation
      document.getElementById('pmEnabled').checked = s.passwordManager !== false
      renderApps()
      document.getElementById('dlDir').textContent = s.downloadDir || 'Saving to the default Downloads folder'
      renderImportSources()
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
  // v2.2.0 — one-click bookmark import from Chrome/Edge/Brave/Chromium profiles
  function renderImportSources() {
    var box = document.getElementById('impSrc')
    if (!box || !window.aether.bookmarks.importSources) return
    window.aether.bookmarks.importSources().then(function (list) {
      box.innerHTML = ''
      if (!list.length) {
        var none = document.createElement('div')
        none.textContent = 'No Chrome-family browser profiles with bookmarks were found on this machine.'
        none.style.cssText = 'color:var(--ax-faint);font-size:12.5px;padding:2px 2px'
        box.appendChild(none); return
      }
      list.forEach(function (src) {
        var row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--ax-card2);border:1px solid var(--ax-border);border-radius:10px'
        var label = document.createElement('div')
        label.style.cssText = 'flex:1;min-width:0;font-size:13px'
        var name = document.createElement('b'); name.textContent = src.browser + ' — ' + src.profile
        var count = document.createElement('span')
        count.textContent = '  ·  ' + src.count + ' bookmark' + (src.count === 1 ? '' : 's')
        count.style.cssText = 'color:var(--ax-muted2);font-size:11.5px'
        var btn = document.createElement('button')
        btn.className = 'muted-btn'; btn.textContent = 'Import'
        btn.addEventListener('click', function () {
          btn.textContent = 'Importing…'; btn.disabled = true
          window.aether.bookmarks.importProfile(src.id).then(function (r) {
            btn.textContent = 'Import'; btn.disabled = false
            var msg = document.getElementById('impMsg')
            if (msg) msg.textContent = r.label + ': added ' + r.added + (r.skipped ? ', skipped ' + r.skipped : '')
          }).catch(function () {
            btn.textContent = 'Import'; btn.disabled = false
          })
        })
        label.appendChild(name); label.appendChild(count)
        row.appendChild(label); row.appendChild(btn)
        box.appendChild(row)
      })
    }).catch(function () { /* bridge refused — leave the section empty */ })
  }
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
    document.getElementById('tabOrientation').addEventListener('change', function (e) {
      save({ tabOrientation: (e.target as HTMLSelectElement).value === 'left' ? 'left' : 'top' })
    })
    document.getElementById('fdMode').addEventListener('change', function (e) {
      save({ forceDarkMode: (e.target as HTMLSelectElement).value })
    })
    document.getElementById('fdHosts').addEventListener('change', function (e) {
      var hosts = String((e.target as HTMLInputElement).value || '')
        .split(',')
        .map(function (x) { return x.trim() })
        .filter(Boolean)
      save({ forceDarkHosts: hosts })
    })
    document.getElementById('paramScrubber').addEventListener('change', function (e) { save({ paramScrubber: e.target.checked }) })
    document.getElementById('referrerTight').addEventListener('change', function (e) { save({ referrerTight: e.target.checked }) })
    document.getElementById('httpsOnly').addEventListener('change', function (e) { save({ httpsOnly: e.target.checked }) })
    document.getElementById('dohMode').addEventListener('change', function (e) { save({ dohMode: (e.target as HTMLSelectElement).value }) })
    document.getElementById('dohPreset').addEventListener('change', function (e) {
      var v = (e.target as HTMLSelectElement).value
      if (v) document.getElementById('dohCustom').value = ''
      save({ dohTemplate: v || document.getElementById('dohCustom').value.trim() })
    })
    document.getElementById('dohCustom').addEventListener('change', function (e) {
      save({ dohTemplate: String((e.target as HTMLInputElement).value || '').trim() })
    })
    document.getElementById('cdGo').addEventListener('click', function () {
      var kinds = []
      if (document.getElementById('cdHistory').checked) kinds.push('history')
      if (document.getElementById('cdCookies').checked) kinds.push('cookies')
      if (document.getElementById('cdCache').checked) kinds.push('cache')
      if (document.getElementById('cdSiteData').checked) kinds.push('siteData')
      if (!kinds.length) { document.getElementById('cdStatus').textContent = 'pick something first'; return }
      var btn = this
      btn.disabled = true
      window.aether.privacy.clearData({ kinds: kinds, range: document.getElementById('cdRange').value }).then(function (res) {
        btn.disabled = false
        var parts = []
        if (res.history) parts.push('history')
        if (res.storage) parts.push('site data')
        if (res.cache) parts.push('cache')
        document.getElementById('cdStatus').textContent = parts.length ? 'Cleared: ' + parts.join(', ') : 'Nothing matched'
      }).catch(function () {
        btn.disabled = false
        document.getElementById('cdStatus').textContent = 'Failed'
      })
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
  document.getElementById('searchDepth').addEventListener('change', function (e) { save({ searchDepth: (e.target as HTMLSelectElement).value }) })
  document.getElementById('tldrHosts').addEventListener('change', function (e) {
    var hosts = String((e.target as HTMLInputElement).value || '').split(',').map(function (x) { return x.trim() }).filter(Boolean)
    save({ tldrHosts: hosts })
  })
  document.getElementById('pledgeLink').addEventListener('click', function (e) {
    e.preventDefault()
    try { window.aether.internal.open('aether://privacy') } catch (err) {}
  })
  document.getElementById('confirmAgentActions').addEventListener('change', function (e) { save({ confirmAgentActions: e.target.checked }) })
  document.getElementById('showBookmarksBar').addEventListener('change', function (e) {
    // ui.setBookmarksBar persists AND broadcasts to every window — don't double-save
    try { window.aether.ui.setBookmarksBar(e.target.checked) } catch (err) { save({ showBookmarksBar: e.target.checked }) }
  })
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
  document.getElementById('grantTtl').addEventListener('change', function (e) { save({ grantTtlDays: Number(e.target.value) || 0 }) })
  document.getElementById('showTray').addEventListener('change', function (e) { save({ showTray: e.target.checked }) })
  document.getElementById('closeToTray').addEventListener('change', function (e) { save({ closeToTray: e.target.checked }) })
  document.getElementById('startupBoost').addEventListener('change', function (e) { save({ startupBoost: e.target.checked }) })
  document.getElementById('notifyDownloads').addEventListener('change', function (e) { save({ notifyDownloads: e.target.checked }) })
  document.getElementById('spellcheck').addEventListener('change', function (e) { save({ spellcheck: e.target.checked }) })
  document.getElementById('askDownloadLocation').addEventListener('change', function (e) { save({ askDownloadLocation: e.target.checked }) })
  document.getElementById('pmEnabled').addEventListener('change', function (e) { save({ passwordManager: e.target.checked }) })
  document.getElementById('pmOpen').addEventListener('click', function () { window.aether.internal.open('aether://passwords') })
  function renderApps() {
    window.aether.apps.list().then(function (apps) {
      var box = document.getElementById('appsList')
      box.innerHTML = ''
      document.getElementById('appsEmpty').style.display = apps.length ? 'none' : 'block'
      apps.forEach(function (a) {
        var row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--ax-card2);border:1px solid var(--ax-border);border-radius:10px'
        var ic = document.createElement('div')
        ic.className = 'ic none'
        ic.textContent = (a.shortName || a.name || '?').charAt(0).toUpperCase()
        var meta = document.createElement('div')
        meta.style.cssText = 'min-width:0;flex:1'
        var t = document.createElement('div')
        t.textContent = a.name
        t.style.cssText = 'font-size:13px;color:var(--ax-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        var u = document.createElement('div')
        u.textContent = a.url
        u.style.cssText = 'font-size:11px;color:var(--ax-muted2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        meta.appendChild(t); meta.appendChild(u)
        var open = document.createElement('button')
        open.className = 'save-btn'
        open.textContent = 'Open'
        open.addEventListener('click', function () { window.aether.apps.launch(a.id) })
        var del = document.createElement('button')
        del.className = 'muted-btn'
        del.textContent = 'Remove'
        del.addEventListener('click', function () { window.aether.apps.remove(a.id).then(renderApps) })
        row.appendChild(ic); row.appendChild(meta); row.appendChild(open); row.appendChild(del)
        box.appendChild(row)
      })
    }).catch(function () { /* bridge down — ignore */ })
  }
  // v2.4.0 build 18 — Profiles manager (list / create / rename / delete / switch)
  var PROF_COLORS = ['#7c8cff', '#4cc38a', '#f5a623', '#ef6c6c', '#5ac8fa', '#c792ea', '#f06292', '#9ccc65']
  ;(function fillProfColors() {
    var sel = document.getElementById('profColor')
    PROF_COLORS.forEach(function (c, i) {
      var o = document.createElement('option')
      o.value = c
      o.textContent = 'Color ' + (i + 1)
      sel.appendChild(o)
    })
  })()
  function profMsg(text) {
    var m = document.getElementById('profMsg')
    m.textContent = text
    setTimeout(function () { m.textContent = '' }, 3200)
  }
  function renderProfiles() {
    window.aether.profiles.list().then(function (r) {
      var box = document.getElementById('profList')
      box.textContent = ''
      r.profiles.forEach(function (p) {
        var row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--ax-card2);border:1px solid var(--ax-border);border-radius:10px'
        var dot = document.createElement('span')
        dot.textContent = (p.name || '?').charAt(0).toUpperCase()
        dot.style.cssText = 'width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0;background:' + p.color
        var name = document.createElement('div')
        name.textContent = p.name
        name.style.cssText = 'font-size:13px;color:var(--ax-fg);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        var actions = document.createElement('div')
        actions.style.cssText = 'display:flex;gap:8px;align-items:center'
        if (p.id === r.activeId) {
          var badge = document.createElement('span')
          badge.textContent = 'Active'
          badge.style.cssText = 'font-size:11px;color:var(--ax-ok);font-weight:600'
          actions.appendChild(badge)
        } else {
          var sw = document.createElement('button')
          sw.className = 'save-btn'
          sw.textContent = 'Switch'
          sw.addEventListener('click', function () { window.aether.profiles.switch(p.id) })
          var rn = document.createElement('button')
          rn.className = 'muted-btn'
          rn.textContent = 'Rename'
          rn.addEventListener('click', function () {
            var next = window.prompt('New name for “' + p.name + '”', p.name)
            if (next && next.trim()) window.aether.profiles.rename(p.id, next.trim()).then(renderProfiles)
          })
          actions.appendChild(sw); actions.appendChild(rn)
          var del = document.createElement('button')
          del.className = 'muted-btn'
          del.textContent = 'Delete'
          del.addEventListener('click', function () {
            if (!window.confirm('Delete profile “' + p.name + '” and ALL of its data (history, bookmarks, passwords, cookies)? This cannot be undone.')) return
            window.aether.profiles.remove(p.id).then(function (res) {
              if (res && res.ok) renderProfiles()
              else profMsg((res && res.error) || 'Delete failed')
            })
          })
          actions.appendChild(del)
        }
        row.appendChild(dot); row.appendChild(name); row.appendChild(actions)
        box.appendChild(row)
      })
    }).catch(function () { /* bridge down — ignore */ })
  }
  document.getElementById('profAdd').addEventListener('click', function () {
    var nameEl = document.getElementById('profName')
    var colorEl = document.getElementById('profColor')
    window.aether.profiles.create(nameEl.value, colorEl.value).then(function (res) {
      if (res && res.ok) {
        nameEl.value = ''
        renderProfiles()
        profMsg('Profile created — switch to it any time')
      } else {
        profMsg((res && res.error) || 'Could not create the profile')
      }
    })
  })
  renderProfiles()
  document.getElementById('dlChoose').addEventListener('click', async function () {
    try {
      const dir = await window.aether.downloads.chooseDir()
      if (dir) {
        save({ downloadDir: dir })
        document.getElementById('dlDir').textContent = dir
      }
    } catch (err) {
      /* dialog refused — keep the current folder */
    }
  })
  document.getElementById('impFile').addEventListener('click', async function () {
    const msg = document.getElementById('impMsg')
    try {
      const r = await window.aether.bookmarks.importFile()
      msg.textContent = r && r.files
        ? 'Imported ' + r.added + ' bookmark' + (r.added === 1 ? '' : 's') + (r.skipped ? ' — ' + r.skipped + ' already saved' : '')
        : 'Nothing imported'
    } catch (err) {
      msg.textContent = 'Import failed'
    }
  })
  document.getElementById('bmExport').addEventListener('click', async function () {
    const msg = document.getElementById('impMsg')
    try {
      const p = await window.aether.bookmarks.export()
      msg.textContent = p ? 'Exported to ' + p : ''
    } catch (err) {
      msg.textContent = 'Export failed'
    }
  })
  document.getElementById('certForget').addEventListener('click', async function () {
    try {
      const n = await window.aether.certs.forget()
      this.textContent = n > 0 ? 'Forgot ' + n + ' exception' + (n === 1 ? '' : 's') : 'Nothing to forget'
    } catch (err) { this.textContent = 'Failed' }
    const btn = this
    setTimeout(function () { btn.textContent = 'Forget remembered certificate exceptions' }, 2500)
  })
  document.getElementById('extprotoForget').addEventListener('click', async function () {
    try {
      const n = await window.aether.extproto.forget()
      this.textContent = n > 0 ? 'Reset ' + n + ' choice' + (n === 1 ? '' : 's') : 'Nothing to reset'
    } catch (err) { this.textContent = 'Failed' }
    const btn = this
    setTimeout(function () { btn.textContent = 'Reset remembered app-launch choices' }, 2500)
  })
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

export const READER_HTML = pageShell(
  'Reader',
  `
  <div id="rd-wrap" style="display:none; width:100%; max-width:760px; margin:0 auto; padding:34px 28px 80px;
    -webkit-user-select:text; user-select:text;">
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:26px;">
      <div style="display:flex; gap:8px;">
        <button id="rd-font-minus" title="Smaller text" style="width:34px; height:34px; border-radius:8px; cursor:pointer;
          background:var(--ax-card); border:1px solid var(--ax-border); color:var(--ax-fg); font-size:12px;">A&minus;</button>
        <button id="rd-font-plus" title="Larger text" style="width:34px; height:34px; border-radius:8px; cursor:pointer;
          background:var(--ax-card); border:1px solid var(--ax-border); color:var(--ax-fg); font-size:14px;">A+</button>
      </div>
      <button id="rd-open" style="padding:8px 14px; border-radius:8px; cursor:pointer; font-size:12px;
        background:var(--ax-accent-soft); color:var(--ax-accent); border:none;">Open original ↗</button>
    </div>
    <h1 id="rd-title" style="font-size:30px; line-height:1.25; font-weight:700; letter-spacing:-0.01em;"></h1>
    <div id="rd-meta" style="margin-top:12px; color:var(--ax-muted); font-size:12.5px; letter-spacing:.02em;"></div>
    <div id="rd-src" style="margin-top:5px; color:var(--ax-faint); font-size:11.5px; word-break:break-all;"></div>
    <hr style="border:none; border-top:1px solid var(--ax-border); margin:26px 0;" />
    <article id="rd-content" style="font-size:19px; line-height:1.75; font-family:Georgia, 'Times New Roman', serif;"></article>
    <div style="margin-top:26px; color:var(--ax-faint); font-size:11px;">Aether Browser ${VER} — reader view</div>
  </div>
  <div id="rd-empty" style="display:none; width:min(520px,88vw); margin-top:18vh; text-align:center;">
    <div style="font-size:44px; line-height:1;">📖</div>
    <div style="margin-top:18px; font-size:17px; font-weight:600;">No article captured</div>
    <div style="margin-top:8px; color:var(--ax-muted); font-size:13px; line-height:1.6;">
      Open a web page (http/https) first, then press <b>F9</b> or right-click → “Open in reader view”.<br />
      Reader view re-renders articles with clean typography — no ads, no clutter, all local.
    </div>
  </div>
  `,
  `
  var fontPx = 19
  function bridgeDown() {
    var el = document.getElementById('rd-empty')
    el.style.display = 'block'
    el.querySelector('div:nth-child(2)').textContent = 'UI bridge unavailable'
    el.querySelector('div:nth-child(3)').textContent = 'Fully quit Aether and start it again; if it keeps happening, run: npm run build'
  }
  function render(a) {
    document.getElementById('rd-title').textContent = a.title || 'Untitled'
    var meta = []
    if (a.siteName) meta.push(a.siteName)
    if (a.byline) meta.push(a.byline)
    meta.push(a.minutes + (a.minutes === 1 ? ' min read' : ' min read'))
    if (a.words) meta.push(String(a.words).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + ' words')
    document.getElementById('rd-meta').textContent = meta.join('  ·  ')
    document.getElementById('rd-src').textContent = a.url || ''
    var content = document.getElementById('rd-content')
    // Sanitized upstream in main/reader.ts (strict tag+attribute whitelist) —
    // the nonce-locked CSP is the second line of defense.
    content.innerHTML = a.content || ''
    content.addEventListener('click', function (e) {
      var t = e.target
      while (t && t.tagName !== 'A') t = t.parentElement
      if (!t) return
      e.preventDefault()
      var href = t.getAttribute('href')
      if (href) window.aether.internal.open(href)
    })
    document.getElementById('rd-open').addEventListener('click', function () {
      if (a.url) window.aether.internal.open(a.url)
    })
    document.getElementById('rd-wrap').style.display = 'block'
  }
  function applyFont() {
    document.getElementById('rd-content').style.fontSize = fontPx + 'px'
  }
  document.getElementById('rd-font-minus').addEventListener('click', function () {
    fontPx = Math.max(14, fontPx - 1)
    applyFont()
  })
  document.getElementById('rd-font-plus').addEventListener('click', function () {
    fontPx = Math.min(28, fontPx + 1)
    applyFont()
  })
  if (typeof window.aether === 'undefined') {
    bridgeDown()
  } else {
    window.aether.reader.get().then(function (a) {
      if (a && a.content) render(a)
      else document.getElementById('rd-empty').style.display = 'block'
    }).catch(function () {
      document.getElementById('rd-empty').style.display = 'block'
    })
  }
  `
)

export const TASKMGR_HTML = pageShell(
  'Task Manager',
  `
  <div style="width:min(880px,94vw); margin-top:9vh;">
    <div style="display:flex; align-items:baseline; justify-content:space-between;">
      <h1 style="font-size:24px; font-weight:700; letter-spacing:-0.01em;">Task Manager</h1>
      <div style="color:var(--ax-muted); font-size:12px;" id="tm-total">measuring…</div>
    </div>
    <div style="margin-top:6px; color:var(--ax-muted); font-size:12.5px;">
      Live CPU and memory of every Aether process, refreshed every 1.5&nbsp;seconds.
      Tabs can be ended individually if one misbehaves.
    </div>
    <div style="margin-top:18px; border:1px solid var(--ax-border); border-radius:12px; overflow:hidden; background:var(--ax-card);">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="text-align:left; color:var(--ax-muted); font-size:11px; letter-spacing:.08em;">
            <th style="padding:10px 14px; font-weight:600;">TASK</th>
            <th style="padding:10px 14px; font-weight:600; width:110px;">MEMORY</th>
            <th style="padding:10px 14px; font-weight:600; width:70px;">CPU</th>
            <th style="padding:10px 14px; font-weight:600; width:60px;"></th>
          </tr>
        </thead>
        <tbody id="tm-rows"></tbody>
      </table>
    </div>
    <div style="margin-top:26px; color:var(--ax-faint); font-size:11px;">Aether Browser ${VER}</div>
  </div>
  `,
  `
  var rowsEl = document.getElementById('tm-rows')
  var totalEl = document.getElementById('tm-total')
  function fmtB(bytes) {
    var b = Number(bytes) || 0
    var abs = Math.abs(b)
    if (abs < 1024) return Math.round(b) + ' B'
    var units = ['KB', 'MB', 'GB', 'TB']
    var v = b / 1024, i = 0
    while (Math.abs(v) >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + ' ' + units[i]
  }
  function cell(text, opts) {
    var td = document.createElement('td')
    td.style.padding = '9px 14px'
    td.style.borderTop = '1px solid var(--ax-border)'
    td.style.verticalAlign = 'top'
    if (opts && opts.muted) td.style.color = 'var(--ax-muted)'
    if (opts && opts.mono) td.style.fontVariantNumeric = 'tabular-nums'
    td.textContent = text
    return td
  }
  function load() {
    var p = window.aether.taskmgr.snapshot()
    if (!p || !p.then) return
    p.then(function (s) {
      while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild)
      for (var i = 0; i < s.rows.length; i++) {
        (function (r) {
          var tr = document.createElement('tr')
          var name = document.createElement('div')
          name.textContent = r.label || '(unnamed)'
          name.style.fontWeight = '600'
          var sub = document.createElement('div')
          sub.textContent = (r.sublabel || r.pid + ' · ' + r.kind) + ''
          sub.style.color = 'var(--ax-muted)'
          sub.style.fontSize = '11px'
          sub.style.marginTop = '2px'
          sub.style.wordBreak = 'break-all'
          var tdName = cell('', {})
          tdName.appendChild(name)
          tdName.appendChild(sub)
          tr.appendChild(tdName)
          tr.appendChild(cell(r.memStr, { mono: true }))
          tr.appendChild(cell(r.cpuStr, { mono: true }))
          var tdAct = cell('', {})
          if (r.kill) {
            var btn = document.createElement('button')
            btn.textContent = 'End'
            btn.style.padding = '4px 12px'
            btn.style.borderRadius = '7px'
            btn.style.cursor = 'pointer'
            btn.style.fontSize = '11.5px'
            btn.style.border = '1px solid var(--ax-danger-border)'
            btn.style.background = 'var(--ax-danger-bg)'
            btn.style.color = 'var(--ax-danger)'
            btn.addEventListener('click', function () {
              window.aether.taskmgr.kill(r.kill.winId, r.kill.tabId).then(load)
            })
            tdAct.appendChild(btn)
          }
          tr.appendChild(tdAct)
          rowsEl.appendChild(tr)
        })(s.rows[i])
      }
      totalEl.textContent = fmtB(s.totalMemBytes) + ' total · ' + s.rows.length + ' processes'
    }).catch(function () {
      totalEl.textContent = 'unavailable'
    })
  }
  if (typeof window.aether === 'undefined') {
    totalEl.textContent = 'UI bridge unavailable — fully quit Aether and start it again.'
  } else {
    load()
    setInterval(load, 1500)
  }
  `
)
