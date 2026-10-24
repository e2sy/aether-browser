/**
 * Bridge probe: loads aether://newtab in a sandboxed WebContentsView (exactly
 * like a real tab) and reports whether the preload exposed window.aether.
 * Run:  DISPLAY=:99 npx electron scripts/probe-bridge.cjs
 */
const { app, BrowserWindow, WebContentsView } = require('electron')
const path = require('node:path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 800 })
  const v = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  win.contentView.addChildView(v)
  // surface preload/page errors from the renderer side
  v.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log('PAGE-CONSOLE [lvl', level, ']', message, '@', sourceId + ':' + line)
  })
  // The preload runs on ANY page — use a data URL so no protocol setup is needed.
  await v.webContents.loadURL('data:text/html,<h1>probe</h1>')
  await new Promise((r) => setTimeout(r, 800))
  const bridgeType = await v.webContents.executeJavaScript('typeof window.aether')
  console.log('PROBE aether://newtab -> typeof window.aether =', bridgeType)
  const startupWorks = bridgeType === 'object' ? await v.webContents.executeJavaScript(
    'window.aether.internal.startup().then(function (d) { return !!d && Array.isArray(d.topSites) }).catch(function (e) { return "ERR:" + e.message })'
  ) : 'n/a'
  console.log('PROBE internal.startup() resolves =', startupWorks)
  app.exit(0)
}).catch((err) => {
  console.error('PROBE failed:', err)
  app.exit(1)
})
