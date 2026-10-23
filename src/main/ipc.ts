import { ipcMain, IpcMainEvent, IpcMainInvokeEvent, BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { TabManager } from './tabs'
import type { ChatMsg, Settings, SidebarInject, SearchResult } from '../shared/types'
import {
  settings,
  bookmarks,
  isBookmarked,
  toggleBookmark,
  removeBookmark,
  topSites,
  recentHistory,
  searchHistory,
  searchBookmarks,
  searchOmnibox,
  deleteHistory,
  clearHistory,
  mergedSettings,
  DEFAULT_SETTINGS
} from './store'
import { applyAdblockSetting } from './adblock'
import { ollamaHealth, listModels, pickDefaultModel, chatStream, friendlyError, OllamaMessage } from './ollama'
import { extractPage } from './extract'
import { webSearch, answerStream } from './search'
import { agentRunner } from './agent/executor'
import { chatWithPageSystem } from './agent/prompts'

const HISTORY_WINDOW = 20

interface Deps {
  getWindow: () => BrowserWindow | null
  getTabs: () => TabManager | undefined
  ui: { sidebarOpen: boolean }
  applyLayout: () => void
}

const aborts = new Map<string, AbortController>()

function isChrome(e: IpcMainEvent | IpcMainInvokeEvent, win: BrowserWindow | null): boolean {
  return Boolean(win && e.sender === win.webContents)
}

function isInternal(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  try {
    return (e.sender.getURL() || '').startsWith('aether://')
  } catch {
    return false
  }
}

function privileged(e: IpcMainEvent | IpcMainInvokeEvent, win: BrowserWindow | null): boolean {
  return isChrome(e, win) || isInternal(e)
}

/** Guard helper — throws for unauthorized senders so pages can't drive the browser. */
function guard(e: IpcMainEvent | IpcMainInvokeEvent, win: BrowserWindow | null, who: string): void {
  if (!privileged(e, win)) {
    throw new Error(`Unauthorized IPC call to ${who} from ${e.sender.getURL() || 'unknown'}`)
  }
}

function requireTab(tm: TabManager | undefined, id: number) {
  const tab = tm?.get(id)
  if (!tab) throw new Error('Tab not found: ' + id)
  return tab
}

export function registerIpc(deps: Deps): void {
  const { getWindow, getTabs, ui, applyLayout } = deps
  const win = (): BrowserWindow | null => getWindow()
  const tm = (): TabManager | undefined => getTabs()

  // ---------- tabs ----------
  ipcMain.handle('tabs:create', (e, url?: string) => {
    guard(e, win(), 'tabs:create')
    return tm()?.create(url && /^https?:\/\//i.test(url) ? url : undefined)
  })

  ipcMain.handle('tabs:list', (e) => {
    guard(e, win(), 'tabs:list')
    return tm()?.getState()
  })

  ipcMain.handle('tabs:omnibox', (e, id: number, text: string) => {
    guard(e, win(), 'tabs:omnibox')
    tm()?.navigate(Number(id), String(text || ''))
  })

  const simple = (channel: string, fn: (t: TabManager, id: number) => void): void => {
    ipcMain.handle(channel, (e, id: number) => {
      guard(e, win(), channel)
      const manager = tm()
      if (manager) fn(manager, Number(id))
    })
  }
  simple('tabs:close', (m, id) => m.close(id))
  simple('tabs:activate', (m, id) => m.activate(id))
  simple('tabs:back', (m, id) => m.back(id))
  simple('tabs:forward', (m, id) => m.forward(id))
  simple('tabs:reload', (m, id) => m.reload(id))
  simple('tabs:stop', (m, id) => m.stop(id))

  ipcMain.handle('tabs:reorder', (e, from: number, to: number) => {
    guard(e, win(), 'tabs:reorder')
    tm()?.reorder(Number(from), Number(to))
  })

  // ---------- window chrome ----------
  ipcMain.handle('ui:setSidebar', (e, open: boolean) => {
    guard(e, win(), 'ui:setSidebar')
    ui.sidebarOpen = Boolean(open)
    applyLayout()
  })

  ipcMain.handle('win:minimize', (e) => {
    guard(e, win(), 'win:minimize')
    win()?.minimize()
  })
  ipcMain.handle('win:maximizeToggle', (e) => {
    guard(e, win(), 'win:maximizeToggle')
    const w = win()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle('win:close', (e) => {
    guard(e, win(), 'win:close')
    win()?.close()
  })

  // ---------- settings / bookmarks / history ----------
  ipcMain.handle('settings:get', (e) => {
    guard(e, win(), 'settings:get')
    return mergedSettings()
  })
  ipcMain.handle('settings:set', (e, patch: Partial<Settings>) => {
    guard(e, win(), 'settings:set')
    settings.data = { ...DEFAULT_SETTINGS, ...settings.data, ...patch }
    settings.save()
    if (patch.adblock !== undefined) {
      void applyAdblockSetting(Boolean(patch.adblock))
    }
    return mergedSettings()
  })

  ipcMain.handle('bookmarks:toggle', (e, entry: { url: string; title: string }) => {
    guard(e, win(), 'bookmarks:toggle')
    return toggleBookmark(entry)
  })
  ipcMain.handle('bookmarks:is', (e, url: string) => isBookmarked(String(url || '')))
  ipcMain.handle('bookmarks:list', (e) => bookmarks.data)
  ipcMain.handle('bookmarks:remove', (e, url: string) => {
    guard(e, win(), 'bookmarks:remove')
    removeBookmark(String(url || ''))
  })
  ipcMain.handle('bookmarks:search', (e, q: string) => {
    guard(e, win(), 'bookmarks:search')
    return searchBookmarks(String(q || ''), 300)
  })
  ipcMain.handle('history:recent', (e) => {
    guard(e, win(), 'history:recent')
    return recentHistory(30)
  })
  ipcMain.handle('history:search', (e, q: string) => {
    guard(e, win(), 'history:search')
    return searchHistory(String(q || ''), 300)
  })
  ipcMain.handle('history:remove', (e, url: string) => {
    guard(e, win(), 'history:remove')
    deleteHistory(String(url || ''))
  })
  ipcMain.handle('history:clear', (e) => {
    guard(e, win(), 'history:clear')
    clearHistory()
  })
  ipcMain.handle('omnibox:suggest', (e, q: string) => {
    guard(e, win(), 'omnibox:suggest')
    return searchOmnibox(String(q || ''), 5)
  })

  // ---------- AI: health / models (chrome + internal pages only) ----------
  ipcMain.handle('ai:health', async (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    return { ok: await ollamaHealth() }
  })

  ipcMain.handle('ai:models', async (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    try {
      return { models: await listModels() }
    } catch (err) {
      return { models: [], error: friendlyError(err) }
    }
  })

  ipcMain.handle('ai:pageContext', async (e) => {
    guard(e, win(), 'ai:pageContext')
    const view = tm()?.activeView()
    if (!view) return null
    return extractPage(view)
  })

  ipcMain.handle(
    'ai:chat',
    async (e, payload: { requestId: string; messages: ChatMsg[]; usePageContext?: boolean; model?: string }) => {
      guard(e, win(), 'ai:chat')
      const requestId = String(payload.requestId)
      const sender: WebContents = e.sender
      const ctrl = new AbortController()
      aborts.set(requestId, ctrl)

      try {
        const model = payload.model || settings.data.model || (await pickDefaultModel())
        if (!model) throw new Error('No Ollama model found. Run:  ollama pull qwen3.5:9b')

        const messages: OllamaMessage[] = []
        if (payload.usePageContext) {
          const view = tm()?.activeView()
          if (view) {
            const page = await extractPage(view)
            if (page) messages.push({ role: 'system', content: chatWithPageSystem(page) })
          }
        }
        messages.push(...payload.messages.slice(-HISTORY_WINDOW))

        let full = ''
        for await (const delta of chatStream(model, messages, ctrl.signal)) {
          full += delta
          if (!sender.isDestroyed()) sender.send('ai:chunk', { requestId, delta })
        }
        return { content: full, model }
      } catch (err) {
        const msg = ctrl.signal.aborted ? 'Aborted.' : friendlyError(err)
        if (!sender.isDestroyed()) sender.send('ai:chunk', { requestId, error: msg })
        return { error: msg }
      } finally {
        aborts.delete(requestId)
      }
    }
  )

  ipcMain.handle('ai:abort', (e, requestId: string) => {
    guard(e, win(), 'ai:abort')
    aborts.get(String(requestId))?.abort()
  })

  // ---------- AI: agent ----------
  ipcMain.handle('agent:run', async (e, task: string) => {
    guard(e, win(), 'agent:run')
    const manager = tm()
    const view = manager?.activeView()
    if (!manager || !view) throw new Error('No active tab')
    // fire and forget — progress streams via 'agent:event'
    agentRunner.run(String(task || ''), view, manager, e.sender).catch((err) => {
      console.error('[agent] crashed', err)
    })
    return { started: true }
  })

  ipcMain.handle('agent:respond', (e, requestId: string, approved: boolean) => {
    guard(e, win(), 'agent:respond')
    agentRunner.respondConfirm(String(requestId), Boolean(approved))
  })

  ipcMain.handle('agent:answer', (e, requestId: string, text: string) => {
    guard(e, win(), 'agent:answer')
    agentRunner.answer(String(requestId), String(text || ''))
  })

  ipcMain.handle('agent:cancel', (e, requestId: string) => {
    guard(e, win(), 'agent:cancel')
    agentRunner.cancel(String(requestId))
  })

  // ---------- internal pages (aether://) ----------
  ipcMain.handle('internal:search', (e, q: string) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    const text = String(q || '').trim()
    if (text) e.sender.loadURL('aether://search?q=' + encodeURIComponent(text))
  })

  ipcMain.handle('internal:open', (e, url: string) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    const target = String(url || '')
    if (/^https?:\/\//i.test(target) || target.startsWith('aether://')) e.sender.loadURL(target)
  })

  ipcMain.handle('internal:startup', (e) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    return { topSites: topSites(8), bookmarks: bookmarks.data.slice(0, 6) }
  })

  ipcMain.handle('internal:ask', async (e, payload: { requestId: string; q: string }) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    const requestId = String(payload.requestId)
    const sender: WebContents = e.sender
    const ctrl = new AbortController()
    aborts.set(requestId, ctrl)
    const send = (chunk: Record<string, unknown>): void => {
      if (!sender.isDestroyed()) sender.send('search:chunk', { requestId, ...chunk })
    }

    try {
      let sources: SearchResult[] = []
      try {
        sources = await webSearch(String(payload.q || ''))
      } catch (err) {
        send({ error: 'Web search failed: ' + (err instanceof Error ? err.message : String(err)) })
        sources = []
      }
      send({ sources })

      const model = settings.data.model || (await pickDefaultModel())
      if (!model) {
        send({ error: 'Ollama is not set up — showing web results only. Install Ollama and run:  ollama pull qwen3.5:9b' })
        return { ok: false }
      }
      for await (const delta of answerStream(String(payload.q || ''), sources, model, ctrl.signal)) {
        send({ delta })
      }
      send({ done: true })
      return { ok: true }
    } catch (err) {
      const msg = ctrl.signal.aborted ? 'Aborted.' : friendlyError(err)
      send({ error: msg })
      return { error: msg }
    } finally {
      aborts.delete(requestId)
    }
  })
}

export function newRequestId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10)
}

export type { SidebarInject }
