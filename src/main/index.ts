import { app, BrowserWindow, Menu, protocol, session } from 'electron'
import path from 'node:path'
import { TabManager } from './tabs'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { NEW_TAB_HTML, SEARCH_HTML } from './pages'

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
  protocol.handle('aether', (req) => {
    const url = new URL(req.url)
    const html =
      url.hostname === 'search'
        ? SEARCH_HTML
        : url.hostname === 'newtab'
          ? NEW_TAB_HTML
          : '<h1>404</h1>'
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })

  // conservative permission policy for web content
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
  })

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
      const state = tabs?.getState()
      console.log('[smoke] tabs:', JSON.stringify(state))
      const loaded = state?.tabs.some((t) => t.url.startsWith('aether://newtab'))
      console.log('[smoke] internal newtab loaded:', loaded ? 'YES' : 'NO')
      app.exit(loaded ? 0 : 1)
    }, 5000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
