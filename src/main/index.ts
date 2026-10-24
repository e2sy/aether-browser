import { app, Menu, protocol, session } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { NEW_TAB_HTML, SEARCH_HTML, HISTORY_HTML, BOOKMARKS_HTML, SETTINGS_HTML } from './pages'
import { applyAdblockSetting } from './adblock'
import { mergedSettings } from './store'
import { installPermissionHandlers } from './permissions'
import { initExtensions } from './extensions'
import { installDownloadHandler } from './downloads'
import {
  setPreloadPath,
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
    settings: SETTINGS_HTML
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
      app.exit(newtabLoaded && settingsLoaded && multiWindowOk ? 0 : 1)
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
