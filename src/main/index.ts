import { app, Menu, protocol, session } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { NEW_TAB_HTML, SEARCH_HTML, HISTORY_HTML, BOOKMARKS_HTML, SETTINGS_HTML, ERROR_HTML } from './pages'
import { isErrorPageUrl } from './errmap'
import { applyAdblockSetting } from './adblock'
import { mergedSettings } from './store'
import { installPermissionHandlers } from './permissions'
import { initExtensions } from './extensions'
import { installDownloadHandler } from './downloads'
import {
  setPreloadPath,
  setUiPreloadPath,
  createBrowserWindow,
  focusedEntry,
  allEntries,
  popoutTab,
  focusAnyWindow
} from './windows'
import { installCrxFromArgv } from './crx'

// privileged scheme so internal pages behave like a real origin
protocol.registerSchemesAsPrivileged([
  { scheme: 'aether', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

// headless / CI environments (AETHER_HEADLESS=1 xvfb-run electron .)
if (process.env.AETHER_HEADLESS) app.disableHardwareAcceleration()

if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  focusAnyWindow()
})

app.whenReady().then(() => {
  const INTERNAL_PAGES: Record<string, string> = {
    search: SEARCH_HTML,
    newtab: NEW_TAB_HTML,
    history: HISTORY_HTML,
    bookmarks: BOOKMARKS_HTML,
    settings: SETTINGS_HTML,
    error: ERROR_HTML
  }
  protocol.handle('aether', (req) => {
    const url = new URL(req.url)
    const html = INTERNAL_PAGES[url.hostname] || '<h1>404</h1>'
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })

  // Identify as a regular Chrome so Google / YouTube treat us normally
  // (Electron's default UA carries an Electron/ token that some sites flag).
  if (mergedSettings().stripElectronUA !== false) {
    const ses = session.defaultSession
    ses.setUserAgent(ses.getUserAgent().replace(/\s+Electron\/\S+/, ''))
  }

  // per-site permissions: auto-allow harmless, prompt (and remember) for camera /
  // mic / location / notifications, deny everything else — see main/permissions.ts
  installPermissionHandlers((payload) => {
    // route the prompt to the window that owns the requesting tab
    for (const entry of allEntries()) {
      if (!entry.win.isDestroyed()) entry.win.webContents.send('perm:request', payload)
    }
  })

  // ad & tracker blocking (best-effort, cached filters)
  void applyAdblockSetting(mergedSettings().adblock !== false)

  // one-time global extensions host — resolves tabs across all windows
  initExtensions(() => {
    const entry = focusedEntry()
    return entry ? { tabs: entry.tabs, win: entry.win } : undefined
  })

  // downloads stream to every browser window
  installDownloadHandler()

  registerIpc()

  Menu.setApplicationMenu(buildMenu())

  setPreloadPath(path.join(__dirname, '../preload/index.js'))
  setUiPreloadPath(path.join(__dirname, '../preload/ui.js'))
  createBrowserWindow()

  // One-click .crx install: "Open with Aether" passes the file via argv
  // (Windows/Linux) or the open-file event (macOS).
  void installCrxFromArgv(process.argv)
  app.on('open-file', (e, filePath) => {
    e.preventDefault()
    if (/\.crx$/i.test(filePath) && app.isReady()) void installCrxFromArgv([filePath])
  })

  // CI/headless smoke test hook: AETHER_SMOKE=1 boots, reports state, quits.
  if (process.env.AETHER_SMOKE) {
    console.log('[smoke] window created')
    const smoke = { chrome: false, tab: false, startup: false, enter: false, uiSuggest: false, uiNav: false, errorPage: false }
    // v1.1.4 regression: the preload bridge must be alive in BOTH renderers.
    // (A broken sandboxed preload used to leave window.aether undefined — the
    // whole browser looked fine but every click was dead.)
    setTimeout(async () => {
      const entry = focusedEntry()
      if (!entry) {
        console.log('[smoke] chrome bridge: NO (no window)')
        return
      }
      // chrome UI renderer (React shell, sandbox:false ui.js preload)
      try {
        const ui = await entry.win.webContents.executeJavaScript('typeof window.aether')
        smoke.chrome = ui === 'object'
        console.log('[smoke] chrome bridge:', smoke.chrome ? 'YES' : 'NO (' + String(ui) + ')')
      } catch (err) {
        console.log('[smoke] chrome bridge: NO (' + String(err) + ')')
      }
      // tab view (sandboxed index.js preload) — dedicated probe tab so the
      // other smoke steps' navigations can't interfere; also exercises the
      // real new-tab search box flow end-to-end: type a domain + Enter → navigates
      try {
        const probeId = entry.tabs.create('aether://newtab', true)
        await new Promise((r) => setTimeout(r, 700))
        const wc = entry.tabs.get(probeId)?.view?.webContents
        if (!wc) throw new Error('probe tab has no view')
        const bridge = await wc.executeJavaScript('typeof window.aether')
        smoke.tab = bridge === 'object'
        console.log('[smoke] tab bridge:', smoke.tab ? 'YES' : 'NO (' + String(bridge) + ')')
        const startup = await wc.executeJavaScript(
          'window.aether.internal.startup().then(function (d) { return Array.isArray(d.topSites) }).catch(function (e) { return "ERR:" + e.message })'
        )
        smoke.startup = startup === true
        console.log('[smoke] internal.startup:', smoke.startup ? 'YES' : 'NO (' + String(startup) + ')')
        await wc.executeJavaScript(
          'var __q = document.getElementById("q"); __q.value = "example.com"; __q.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))'
        )
        await new Promise((r) => setTimeout(r, 3500))
        const url = wc.getURL()
        smoke.enter = url.startsWith('https://example.com')
        console.log('[smoke] newtab enter-to-navigate:', smoke.enter ? 'YES' : 'NO (' + url + ')')
      } catch (err) {
        console.log('[smoke] tab bridge: NO (' + String(err) + ')')
      }
    }, 1500)
    // v1.1.5 regression: the IPC trust guard used to REJECT every call from the
    // chrome-UI renderer ("Unauthorized IPC call to omnibox:suggest from
    // http://localhost:5173/") — address bar suggestions, tab strip and all
    // toolbar buttons were dead even though window.aether existed. Drive the
    // exact user flow from the UI's own execution context: suggest + new tab +
    // navigate (what typing in the top omnibox + Enter does).
    setTimeout(async () => {
      const entry = focusedEntry()
      if (!entry) return
      try {
        const sug = await entry.win.webContents.executeJavaScript(
          'window.aether.omnibox.suggest("exa").then(function (r) { return !!r && Array.isArray(r.history) && Array.isArray(r.bookmarks) }).catch(function (e) { return "ERR:" + e.message })'
        )
        smoke.uiSuggest = sug === true
        console.log('[smoke] chrome ipc omnibox.suggest:', smoke.uiSuggest ? 'YES' : 'NO (' + String(sug) + ')')
      } catch (err) {
        console.log('[smoke] chrome ipc omnibox.suggest: NO (' + String(err) + ')')
      }
      try {
        const id = await entry.win.webContents.executeJavaScript(
          'window.aether.tabs.create("aether://newtab").then(function (id) { return window.aether.tabs.omnibox(id, "example.com").then(function () { return id }) }).catch(function (e) { return "ERR:" + e.message })'
        )
        const tabId = typeof id === 'number' ? id : undefined
        if (tabId === undefined) throw new Error(String(id))
        await new Promise((r) => setTimeout(r, 2200))
        const url = entry.tabs.get(tabId)?.url || ''
        smoke.uiNav = url.startsWith('https://example.com')
        console.log('[smoke] chrome ipc tabs.omnibox -> navigate:', smoke.uiNav ? 'YES' : 'NO (' + url + ')')
      } catch (err) {
        console.log('[smoke] chrome ipc tabs.omnibox: NO (' + String(err) + ')')
      }
    }, 2600)
    // v1.1.6 regression: main-frame load failures used to leave an infinite
    // blank view (only a console line + tab title). Now the tab must land on
    // the aether://error page while the omnibox keeps the original URL.
    // http://127.0.0.1:9/ fails fast with ERR_CONNECTION_REFUSED — no network needed.
    setTimeout(async () => {
      const entry = focusedEntry()
      if (!entry) return
      try {
        const id = entry.tabs.create('http://127.0.0.1:9/', true)
        await new Promise((r) => setTimeout(r, 1100))
        const rec = entry.tabs.get(id)
        const wc = rec?.view?.webContents
        const landed = wc ? (() => { try { return wc.getURL() } catch { return '' } })() : ''
        const okErrBase =
          !!rec &&
          isErrorPageUrl(landed) &&
          rec.url === 'http://127.0.0.1:9/' &&
          rec.title === 'Can\u2019t reach this page'
        // the page must actually render: title filled + Retry button present
        const dom = await wc!.executeJavaScript(
          'document.getElementById("err-title").textContent + "|" + (document.getElementById("err-retry") ? "retry" : "no-retry")'
        ).catch(() => 'DOM-ERR')
        const okErr = okErrBase && typeof dom === 'string' && dom.indexOf('Can\u2019t reach this page') === 0 && dom.endsWith('|retry')
        smoke.errorPage = okErr
        console.log(
          '[smoke] error page on failed load:',
          okErr ? 'YES' : 'NO (landed=' + landed.slice(0, 60) + ' url=' + rec?.url + ' title=' + rec?.title + ')'
        )
      } catch (err) {
        console.log('[smoke] error page on failed load: NO (' + String(err) + ')')
      }
    }, 6800)
    let tHistory: number | undefined
    setTimeout(() => {
      const entry = focusedEntry()
      const first = entry?.tabs.listIds()[0]
      if (first !== undefined) entry?.tabs.navigate(first, 'aether://settings')
    }, 3000)
    // v1.0: create background tabs, then exercise memory-saver discard + wake
    setTimeout(() => {
      const entry = focusedEntry()
      entry?.tabs.create('aether://history', true)
      tHistory = entry?.tabs.listIds().find((id) => entry?.tabs.get(id)?.url.includes('history'))
      entry?.tabs.create('aether://bookmarks', true) // pushes history tab to background
    }, 4200)
    setTimeout(() => {
      const entry = focusedEntry()
      if (tHistory !== undefined && entry) {
        entry.tabs.discard(tHistory)
        const rec = entry.tabs.getState().tabs.find((t) => t.id === tHistory)
        console.log('[smoke] discard worked:', rec?.discarded ? 'YES' : 'NO')
      }
    }, 5200)
    setTimeout(() => {
      if (tHistory !== undefined) focusedEntry()?.tabs.activate(tHistory) // should wake the view
    }, 5800)
    // v1.1: multi-window — open a second window, pop a tab out into a third,
    // then exercise hibernate + instant wake in the second window
    setTimeout(() => {
      const first = focusedEntry()
      const before = allEntries().length
      const second = createBrowserWindow('aether://newtab')
      console.log('[smoke] second window created:', allEntries().length === before + 1 ? 'YES' : 'NO')
      if (first && tHistory !== undefined) {
        const newId = popoutTab(first.win.id, tHistory)
        console.log('[smoke] popout created window:', newId !== null ? 'YES' : 'NO')
      }
      // give the second window a background tab, then hibernate + wake it
      second.tabs.create('aether://bookmarks', false)
      const victim = second.tabs.listIds().find((id) => id !== second.tabs.activeId)
      if (victim !== undefined) {
        second.tabs.hibernate(victim)
        const rec = second.tabs.get(victim)
        console.log('[smoke] hibernate worked:', rec?.hibernated ? 'YES' : 'NO')
        second.tabs.activate(victim)
        console.log('[smoke] hibernate wake worked:', rec && !rec.hibernated ? 'YES' : 'NO')
      } else {
        console.log('[smoke] hibernate worked: NO (no background tab)')
        console.log('[smoke] hibernate wake worked: NO')
      }
    }, 6400)
    setTimeout(() => {
      const entries = allEntries()
      const state = focusedEntry()?.tabs.getState()
      console.log('[smoke] tabs:', JSON.stringify(state))
      console.log('[smoke] windows:', entries.length)
      const newtabLoaded = entries.some((en) => en.tabs.getState().tabs.some((t) => t.url.startsWith('aether://')))
      const settingsLoaded = entries.some((en) => en.tabs.getState().tabs.some((t) => t.url.startsWith('aether://settings')))
      console.log('[smoke] internal page loaded:', newtabLoaded ? 'YES' : 'NO')
      console.log('[smoke] settings page loaded:', settingsLoaded ? 'YES' : 'NO')
      const multiWindowOk = entries.length >= 2
      console.log('[smoke] multi-window:', multiWindowOk ? 'YES' : 'NO')
      const bridgesOk =
        smoke.chrome && smoke.tab && smoke.startup && smoke.enter && smoke.uiSuggest && smoke.uiNav && smoke.errorPage
      app.exit(newtabLoaded && settingsLoaded && multiWindowOk && bridgesOk ? 0 : 1)
    }, 8200)
  }

  app.on('activate', () => {
    // macOS dock click — reopen a window if none exist
    if (allEntries().length === 0) createBrowserWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
