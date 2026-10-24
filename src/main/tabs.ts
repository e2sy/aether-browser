import { BrowserWindow, WebContentsView, Rectangle } from 'electron'
import type { TabMeta, TabsState } from '../shared/types'
import { addHistory, getZoomLevel, setZoomLevel, mergedSettings } from './store'
import { onContextMenu } from './menu'
import { resolveInput } from './resolve'
import { notifyTabAdded, notifyTabRemoved, notifyTabSelected } from './extensions'

interface Tab extends TabMeta {
  view: WebContentsView | null
  /** monotonic clock of last activation — drives the memory saver */
  lastActiveAt: number
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

const ZOOM_STEP = 0.5
const ZOOM_MAX = 5.5

/**
 * Pure tier decision for the memory saver (unit-tested):
 *   idle ≥ base      → hibernate (light sleep, instant wake)
 *   idle ≥ 3 × base  → discard   (view unloaded, reload on wake)
 */
export function tierFor(idleMinutes: number, baseMinutes: number): 'none' | 'hibernate' | 'discard' {
  if (!baseMinutes || baseMinutes <= 0) return 'none'
  if (idleMinutes >= baseMinutes * 3) return 'discard'
  if (idleMinutes >= baseMinutes) return 'hibernate'
  return 'none'
}

export interface TabManagerHooks {
  /** called instead of closing the window itself when the last tab closes */
  onEmpty?: (win: BrowserWindow) => void
  /** “Move tab to new window” — implemented by the window manager */
  popout?: (win: BrowserWindow, tabId: number) => void
}

export class TabManager {
  private tabs = new Map<number, Tab>()
  private order: number[] = []
  private nextId = 1
  private bounds: Rectangle = { x: 0, y: 84, width: 1280, height: 700 }
  private saverTimer: NodeJS.Timeout | null = null
  activeId: number | null = null

  constructor(
    private win: BrowserWindow,
    private preloadPath: string,
    private onState: () => void,
    private hooks: TabManagerHooks = {}
  ) {}

  /** The window this tab collection lives in (used by the extensions host). */
  get window(): BrowserWindow {
    return this.win
  }

  create(url = 'aether://newtab', activate = true): number {
    const id = this.nextId++
    const tab: Tab = {
      id,
      view: null,
      title: 'New Tab',
      url,
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      pinned: false,
      muted: false,
      audible: false,
      discarded: false,
      hibernated: false,
      lastActiveAt: Date.now()
    }
    this.tabs.set(id, tab)
    this.order.push(id)
    this.spawnView(tab, url)

    if (activate) this.activate(id)
    this.emit()
    return id
  }

  /** (Re)create the WebContentsView for a tab — used on create and on wake from discard. */
  private spawnView(tab: Tab, url: string): void {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    tab.view = view
    tab.discarded = false
    tab.hibernated = false
    const wc = view.webContents

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
      if (this.activeId === tab.id) tab.lastActiveAt = Date.now()
      this.emit()
    })
    wc.on('did-navigate', (_e, url) => {
      tab.url = url
      tab.canGoBack = wc.navigationHistory.canGoBack()
      tab.canGoForward = wc.navigationHistory.canGoForward()
      addHistory(url, tab.title)
      this.applyStoredZoom(tab)
      this.emit()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      tab.url = url
      tab.canGoBack = wc.navigationHistory.canGoBack()
      tab.canGoForward = wc.navigationHistory.canGoForward()
      addHistory(url, tab.title)
      this.applyStoredZoom(tab)
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
    wc.on('media-started-playing', () => {
      tab.audible = true
      this.emit()
    })
    wc.on('media-paused', () => {
      tab.audible = wc.isCurrentlyAudible()
      this.emit()
    })
    wc.setWindowOpenHandler(({ url: popupUrl }) => {
      if (/^https?:/i.test(popupUrl)) this.create(popupUrl, true)
      return { action: 'deny' }
    })
    wc.on('context-menu', (_e, params) => onContextMenu(wc, params, this))
    wc.on('found-in-page', (_e, result) => {
      this.sendToChrome('find:result', {
        tabId: tab.id,
        active: result.activeMatchOrdinal,
        matches: result.matches
      })
    })

    wc.setAudioMuted(tab.muted)
    view.setBounds(this.bounds)
    notifyTabAdded(wc, this.win)
    wc.loadURL(url).catch(() => undefined)
  }

  /** Restore the per-host zoom saved for this tab's URL, if any. */
  private applyStoredZoom(tab: Tab): void {
    if (!tab.view || !/^https?:/i.test(tab.url)) return
    const host = hostOf(tab.url)
    if (!host) return
    const level = getZoomLevel(host)
    try {
      tab.view.webContents.setZoomLevel(level)
    } catch {
      /* view gone */
    }
  }

  setBounds(b: Rectangle): void {
    this.bounds = b
    for (const tab of this.tabs.values()) {
      try {
        tab.view?.setBounds(b)
      } catch {
        /* view disposed */
      }
    }
  }

  activate(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return

    // wake a memory-saver-discarded tab
    if (tab.discarded || !tab.view) {
      this.spawnView(tab, tab.url || 'aether://newtab')
    } else if (tab.hibernated) {
      this.wake(tab)
    }

    if (this.activeId !== null && this.activeId !== id) {
      const cur = this.tabs.get(this.activeId)
      if (cur?.view) {
        cur.lastActiveAt = Date.now()
        try {
          this.win.contentView.removeChildView(cur.view)
        } catch {
          /* already removed */
        }
      }
    }
    if (tab.view) {
      try {
        this.win.contentView.addChildView(tab.view)
        tab.view.setBounds(this.bounds)
      } catch {
        /* window gone */
      }
    }
    this.activeId = id
    tab.lastActiveAt = Date.now()
    tab.view?.webContents.focus()
    if (tab.view) notifyTabSelected(tab.view.webContents)
    this.emit()
  }

  close(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.destroyView(tab)
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
    if (!this.order.length) {
      if (this.hooks.onEmpty) this.hooks.onEmpty(this.win)
      else this.win.close()
    }
    this.emit()
  }

  /** Tear down the view of a tab (on close, or on discard while keeping the record). */
  private destroyView(tab: Tab): void {
    if (tab.view) {
      notifyTabRemoved(tab.view.webContents)
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
      tab.view = null
    }
    if (this.activeId === tab.id && tab.discarded) this.activeId = null
  }

  get(id: number): Tab | undefined {
    return this.tabs.get(id)
  }

  active(): Tab | undefined {
    return this.activeId !== null ? this.tabs.get(this.activeId) : undefined
  }

  activeView(): WebContentsView | undefined {
    return this.active()?.view ?? undefined
  }

  /** Find a managed tab by its webContents (used by the extensions host). */
  findByWebContents(wc: Electron.WebContents): Tab | undefined {
    for (const tab of this.tabs.values()) {
      if (tab.view && tab.view.webContents === wc) return tab
    }
    return undefined
  }

  navigate(id: number, input: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.discarded || !tab.view) {
      tab.url = resolveInput(input) || tab.url
      if (this.activeId === id) this.activate(id)
      else this.spawnView(tab, tab.url)
      return
    }
    const url = resolveInput(input)
    if (!url) return
    tab.view.webContents.loadURL(url).catch(() => undefined)
  }

  private nav(id: number, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.discarded) {
      if (action === 'reload') this.activate(id)
      return
    }
    const wc = tab.view?.webContents
    if (!wc) return
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

  // ---------- tab lifecycle extras (pin / mute / duplicate / discard) ----------

  /** Pin/unpin a tab. Pinned tabs sort first and show favicon-only. */
  setPinned(id: number, pinned: boolean): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.pinned = pinned
    this.normalizeOrder()
    this.emit()
  }

  togglePinned(id: number): void {
    const tab = this.tabs.get(id)
    if (tab) this.setPinned(id, !tab.pinned)
  }

  setAudioMuted(id: number, muted: boolean): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.muted = muted
    try {
      tab.view?.webContents.setAudioMuted(muted)
    } catch {
      /* view gone */
    }
    this.emit()
  }

  toggleMuted(id: number): void {
    const tab = this.tabs.get(id)
    if (tab) this.setAudioMuted(id, !tab.muted)
  }

  /** Open a copy of the tab right next to it. */
  duplicate(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const url = /^https?:\/\//i.test(tab.url) || tab.url.startsWith('aether://') ? tab.url : undefined
    const newId = this.create(url || undefined, true)
    const at = this.order.indexOf(id)
    const from = this.order.indexOf(newId)
    if (at >= 0 && from >= 0) {
      this.order.splice(from, 1)
      this.order.splice(at + 1, 0, newId)
    }
    this.emit()
  }

  /** Memory saver: unload the view but remember url/title/favicon. */
  discard(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab || tab.discarded) return
    if (tab.pinned || tab.id === this.activeId) return
    tab.discarded = true
    tab.hibernated = false
    tab.loading = false
    tab.canGoBack = false
    tab.canGoForward = false
    tab.audible = false
    this.destroyView(tab)
    this.emit()
  }

  // ---------- tier 1: hibernation (light sleep) ----------

  /**
   * Hibernate a background tab: mute it, throttle rendering to 1 fps and let
   * Chromium background-throttle its timers. The view stays alive, so waking
   * is instant — unlike discard, which reloads the page.
   */
  hibernate(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab || tab.discarded || tab.hibernated) return
    if (tab.pinned || tab.id === this.activeId || !tab.view) return
    tab.hibernated = true
    this.applyHibernation(tab)
    console.log(`[memory-saver] hibernating idle tab ${id} (${tab.url})`)
    this.emit()
  }

  toggleHibernated(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.hibernated) {
      this.wake(tab)
      this.emit()
    } else {
      this.hibernate(id)
    }
  }

  private applyHibernation(tab: Tab): void {
    const wc = tab.view?.webContents
    if (!wc) return
    try {
      wc.setAudioMuted(true)
      wc.setFrameRate(1)
    } catch {
      /* view gone */
    }
  }

  /** Restore a hibernated tab to full speed (called on activation). */
  private wake(tab: Tab): void {
    if (!tab.hibernated) return
    tab.hibernated = false
    const wc = tab.view?.webContents
    if (wc) {
      try {
        wc.setFrameRate(60)
        wc.setAudioMuted(tab.muted)
      } catch {
        /* view gone */
      }
    }
    tab.lastActiveAt = Date.now()
  }

  /** Is this tab allowed to be auto-discarded by the memory saver? */
  private discardable(tab: Tab): boolean {
    return (
      !tab.pinned &&
      tab.id !== this.activeId &&
      !tab.discarded &&
      !tab.loading &&
      !tab.audible &&
      Boolean(tab.view)
    )
  }

  /** Is this tab allowed to be auto-hibernated (tier 1)? */
  private hibernatable(tab: Tab): boolean {
    return this.discardable(tab) && !tab.hibernated
  }

  /** Periodically hibernate then unload idle background tabs (tiered). */
  startMemorySaver(): void {
    if (this.saverTimer) clearInterval(this.saverTimer)
    this.saverTimer = setInterval(() => {
      const minutes = mergedSettings().memorySaver
      if (!minutes || minutes <= 0) return
      const now = Date.now()
      let changed = false
      for (const tab of [...this.tabs.values()]) {
        const idleMin = (now - tab.lastActiveAt) / 60_000
        const tier = tierFor(idleMin, minutes)
        if (tier === 'discard' && this.discardable(tab)) {
          console.log(`[memory-saver] discarding idle tab ${tab.id} (${tab.url})`)
          tab.hibernated = false
          this.discard(tab.id)
          changed = true
        } else if (tier === 'hibernate' && this.hibernatable(tab)) {
          this.hibernate(tab.id)
          changed = true
        }
      }
      if (changed) this.emit()
    }, 30_000)
  }

  stopMemorySaver(): void {
    if (this.saverTimer) clearInterval(this.saverTimer)
    this.saverTimer = null
  }

  /** Move this tab out into its own window (window manager does the work). */
  popout(id: number): void {
    if (this.hooks.popout) this.hooks.popout(this.win, id)
  }

  closeOthers(id: number): void {
    for (const other of [...this.order]) {
      if (other !== id) this.close(other)
    }
  }

  closeRight(id: number): void {
    const idx = this.order.indexOf(id)
    if (idx < 0) return
    for (const other of [...this.order.slice(idx + 1)]) {
      this.close(other)
    }
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
    this.normalizeOrder()
    this.emit()
  }

  /** Keep pinned tabs first (stable within each group). */
  private normalizeOrder(): void {
    const rank = (id: number): number => (this.tabs.get(id)?.pinned ? 0 : 1)
    this.order.sort((a, b) => rank(a) - rank(b))
  }

  // ---------- per-site zoom ----------

  zoom(id: number, action: 'in' | 'out' | 'reset'): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.discarded || !tab.view) {
      // still persist host default so the woken tab picks it up
      if (action === 'reset') {
        const host = hostOf(tab.url)
        if (host) setZoomLevel(host, 0)
      }
      return
    }
    const wc = tab.view.webContents
    const cur = wc.getZoomLevel()
    const next =
      action === 'reset' ? 0 : action === 'in' ? Math.min(ZOOM_MAX, cur + ZOOM_STEP) : Math.max(-ZOOM_MAX, cur - ZOOM_STEP)
    try {
      wc.setZoomLevel(next)
    } catch {
      return
    }
    const host = hostOf(tab.url)
    if (host && /^https?:/i.test(tab.url)) setZoomLevel(host, next)
    this.sendToChrome('zoom:changed', {
      tabId: id,
      level: next,
      percent: Math.round(Math.pow(1.2, next) * 100)
    })
  }

  zoomForActive(action: 'in' | 'out' | 'reset'): void {
    if (this.activeId !== null) this.zoom(this.activeId, action)
  }

  // ---------- find ----------

  /** In-page find (Ctrl+F find bar). */
  find(id: number, query: string, forward = true): void {
    const tab = this.tabs.get(id)
    if (!tab || !query || tab.discarded || !tab.view) return
    tab.view.webContents.findInPage(query, { forward })
  }

  stopFind(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab || tab.discarded || !tab.view) return
    tab.view.webContents.stopFindInPage('clearSelection')
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
      .map((t) => ({
        id: t.id,
        title: t.discarded && !t.title ? 'Discarded tab' : t.title,
        url: t.url,
        favicon: t.favicon,
        loading: t.loading,
        canGoBack: t.canGoBack,
        canGoForward: t.canGoForward,
        pinned: t.pinned,
        muted: t.muted,
        audible: t.audible,
        discarded: t.discarded,
        hibernated: t.hibernated
      }))
    return { tabs, activeId: this.activeId }
  }

  private emit(): void {
    this.onState()
  }
}
