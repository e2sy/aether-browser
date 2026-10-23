import { app, BrowserWindow, Menu, protocol, session } from 'electron'
import path from 'node:path'
import { TabManager } from './tabs'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { NEW_TAB_HTML, SEARCH_HTML, HISTORY_HTML, BOOKMARKS_HTML, SETTINGS_HTML } from './pages'
import { applyAdblockSetting } from './adblock'
import { mergedSettings } from './store'

// privileged scheme so internal pages behave like a real origin
protocol.registerSchemesAsPrivileged([
  { scheme: 'aether', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

// headless / CI environments (AETHER_HEADLESS=1 xvfb-run electron .)
if (process.env.AETHER_HEADLESS) app.disableHardwareAcceleration()

const CHROME_HEIGHT = 84
const SIDEBAR_WIDTH = 400

let win: BrowserWindow | null = null
let tabs: TabManager | null = null
const ui = { sidebarOpen: false }

function applyLayout(): void {
  if (!win || !tabs) return
  const [w, h] = win.getContentSize()
  const sidebar = ui.sidebarOpen ? SIDEBAR_WIDTH : 0
  tabs.setBounds({
    x: 0,
    y: CHROME_HEIGHT,
    width: Math.max(60, w - sidebar),
    height: Math.max(60, h - CHROME_HEIGHT)
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#16171b',
    show: false
  })

  win.once('ready-to-show', () => win?.show())
  win.on('resize', applyLayout)
  win.on('maximize', () => win?.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false))
  win.on('closed', () => {
    win = null
    tabs = null
  })

  const preload = path.join(__dirname, '../preload/index.js')
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.webContents.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.webContents.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  tabs = new TabManager(win, preload, () => {
    if (win && !win.webContents.isDestroyed()) win.webContents.send('tabs:state', tabs!.getState())
  })

  tabs.create()
  applyLayout()
}

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

  // conservative permission policy for web content
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
  })

  // ad & tracker blocking (best-effort, cached filters)
  void applyAdblockSetting(mergedSettings().adblock !== false)

  registerIpc({
    getWindow: () => win,
    getTabs: () => tabs ?? undefined,
    ui,
    applyLayout
  })

  Menu.setApplicationMenu(
    buildMenu({
      getTabs: () => tabs ?? undefined
    })
  )

  createWindow()

  // CI/headless smoke test hook: AETHER_SMOKE=1 boots, reports state, quits.
  if (process.env.AETHER_SMOKE) {
    console.log('[smoke] window created')
    setTimeout(() => {
      const first = tabs?.listIds()[0]
      if (first !== undefined) tabs?.navigate(first, 'aether://settings')
    }, 3000)
    setTimeout(() => {
      const state = tabs?.getState()
      console.log('[smoke] tabs:', JSON.stringify(state))
      const newtabLoaded = state?.tabs.some((t) => t.url.startsWith('aether://'))
      const settingsLoaded = state?.tabs.some((t) => t.url.startsWith('aether://settings'))
      console.log('[smoke] internal page loaded:', newtabLoaded ? 'YES' : 'NO')
      console.log('[smoke] settings page loaded:', settingsLoaded ? 'YES' : 'NO')
      app.exit(newtabLoaded && settingsLoaded ? 0 : 1)
    }, 6500)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
