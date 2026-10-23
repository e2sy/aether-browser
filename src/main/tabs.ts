import { BrowserWindow, WebContentsView, Rectangle } from 'electron'
import type { TabMeta, TabsState } from '../shared/types'
import { addHistory } from './store'
import { onContextMenu } from './menu'
import { resolveInput } from './resolve'

interface Tab extends TabMeta {
  view: WebContentsView
}

export class TabManager {
  private tabs = new Map<number, Tab>()
  private order: number[] = []
  private nextId = 1
  private bounds: Rectangle = { x: 0, y: 84, width: 1280, height: 700 }
  activeId: number | null = null

  constructor(
    private win: BrowserWindow,
    private preloadPath: string,
    private onState: () => void
  ) {}

  create(url = 'aether://newtab', activate = true): number {
    const id = this.nextId++
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    const wc = view.webContents
    const tab: Tab = {
      id,
      view,
      title: 'New Tab',
      url,
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false
    }
    this.tabs.set(id, tab)
    this.order.push(id)

    wc.on('page-title-updated', (_e, title) => {
      tab.title = title || tab.title
      this.emit()
    })
    wc.on('page-favicon-updated', (_e, icons) => {
      tab.favicon = icons.length ? icons[icons.length - 1] : null
      this.emit()
    })
    wc.on('did-start-loading', () => {
      tab.loading = true
      this.emit()
    })
    wc.on('did-stop-loading', () => {
      tab.loading = false
      tab.canGoBack = wc.navigationHistory.canGoBack()
      tab.canGoForward = wc.navigationHistory.canGoForward()
      this.emit()
    })
    wc.on('did-navigate', (_e, url) => {
      tab.url = url
      tab.canGoBack = wc.navigationHistory.canGoBack()
      tab.canGoForward = wc.navigationHistory.canGoForward()
      addHistory(url, tab.title)
      this.emit()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      tab.url = url
      tab.canGoBack = wc.navigationHistory.canGoBack()
      tab.canGoForward = wc.navigationHistory.canGoForward()
      addHistory(url, tab.title)
      this.emit()
    })
    wc.on('did-fail-load', (_e, code, desc, validated, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        tab.title = 'Can\u2019t reach this page'
        console.error(`[tab] failed to load ${validated}: ${code} ${desc}`)
        this.emit()
      }
    })
    wc.on('render-process-gone', () => {
      tab.title = 'Tab crashed'
      this.emit()
    })
    wc.setWindowOpenHandler(({ url: popupUrl }) => {
      if (/^https?:/i.test(popupUrl)) this.create(popupUrl, true)
      return { action: 'deny' }
    })
    wc.on('context-menu', (_e, params) => onContextMenu(wc, params, this))

    view.setBounds(this.bounds)
    wc.loadURL(url).catch(() => undefined)

    if (activate) this.activate(id)
    this.emit()
    return id
  }

  setBounds(b: Rectangle): void {
    this.bounds = b
    for (const tab of this.tabs.values()) {
      try {
        tab.view.setBounds(b)
      } catch {
        /* view disposed */
      }
    }
  }

  activate(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (this.activeId !== null) {
      const cur = this.tabs.get(this.activeId)
      if (cur) {
        try {
          this.win.contentView.removeChildView(cur.view)
        } catch {
          /* already removed */
        }
      }
    }
    this.win.contentView.addChildView(tab.view)
    tab.view.setBounds(this.bounds)
    this.activeId = id
    tab.view.webContents.focus()
    this.emit()
  }

  close(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    try {
      this.win.contentView.removeChildView(tab.view)
    } catch {
      /* ignore */
    }
    try {
      tab.view.webContents.close()
    } catch {
      /* ignore */
    }
    this.tabs.delete(id)
    const idx = this.order.indexOf(id)
    if (idx >= 0) this.order.splice(idx, 1)

    if (this.activeId === id) {
      this.activeId = null
      if (this.order.length) {
        const next = this.order[Math.min(idx, this.order.length - 1)]
        this.activate(next)
      }
    }
    if (!this.order.length) this.win.close()
    this.emit()
  }

  get(id: number): Tab | undefined {
    return this.tabs.get(id)
  }

  active(): Tab | undefined {
    return this.activeId !== null ? this.tabs.get(this.activeId) : undefined
  }

  activeView(): WebContentsView | undefined {
    return this.active()?.view
  }

  navigate(id: number, input: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const url = resolveInput(input)
    if (!url) return
    tab.view.webContents.loadURL(url).catch(() => undefined)
  }

  private nav(id: number, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const wc = tab.view.webContents
    const hist = wc.navigationHistory
    if (action === 'back' && hist.canGoBack()) hist.goBack()
    else if (action === 'forward' && hist.canGoForward()) hist.goForward()
    else if (action === 'reload') wc.reload()
    else if (action === 'stop') wc.stop()
  }

  back(id: number): void {
    this.nav(id, 'back')
  }
  forward(id: number): void {
    this.nav(id, 'forward')
  }
  reload(id: number): void {
    this.nav(id, 'reload')
  }
  stop(id: number): void {
    this.nav(id, 'stop')
  }

  listIds(): number[] {
    return [...this.order]
  }

  /** Reorder tabs (drag & drop): move the tab at fromIdx to toIdx. */
  reorder(fromIdx: number, toIdx: number): void {
    const from = Math.max(0, Math.min(Math.floor(fromIdx), this.order.length - 1))
    const to = Math.max(0, Math.min(Math.floor(toIdx), this.order.length - 1))
    if (from === to) return
    const [id] = this.order.splice(from, 1)
    this.order.splice(to, 0, id)
    this.emit()
  }

  /** Push an event to the browser-chrome renderer (tab strip / sidebar UI). */
  sendToChrome(channel: string, payload: unknown): void {
    const wc = this.win.webContents
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }

  getState(): TabsState {
    const tabs = this.order
      .map((id) => this.tabs.get(id))
      .filter((t): t is Tab => Boolean(t))
      .map(({ id, title, url, favicon, loading, canGoBack, canGoForward }) => ({
        id,
        title,
        url,
        favicon,
        loading,
        canGoBack,
        canGoForward
      }))
    return { tabs, activeId: this.activeId }
  }

  private emit(): void {
    this.onState()
  }
}
