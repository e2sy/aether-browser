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
import { ollamaHealth, listModels, pickDefaultModel, friendlyError, OllamaMessage } from './ollama'
import { listModelsDetailed, deleteModel, modelInfo, runningModels } from './ollama'
import { resolveBrain, streamBrain, aiStatus, brainError, BrainChoice } from './brain'
import { addMemory, memoryPromptFor, hostOf, listMemory, removeMemory, clearMemory } from './memory'
import {
  respondPermission,
  listPermissions,
  revokePermission,
  clearPermissions
} from './permissions'
import { listMacros, saveMacro, deleteMacro, getMacro, updateMacro } from './macros'
import { installDownloadHandler, cancelDownload, revealDownload } from './downloads'
import {
  listExtensionInfos,
  addExtensionFromDialog,
  toggleExtension,
  removeExtension
} from './extensions'
import { MODEL_CATALOG } from './model-catalog'
import { startPull, cancelPull, activePulls } from './model-manager'
import { extractPage } from './extract'
import { webSearch } from './search'
import { agentRunner } from './agent/executor'
import { chatWithPageSystem, SEARCH_SYSTEM } from './agent/prompts'
import type { MacroStep } from '../shared/types'

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

  // tab extras: pin / mute / duplicate / discard / bulk close
  ipcMain.handle('tabs:setPinned', (e, id: number, pinned: boolean) => {
    guard(e, win(), 'tabs:setPinned')
    tm()?.setPinned(Number(id), Boolean(pinned))
  })
  ipcMain.handle('tabs:toggleMuted', (e, id: number) => {
    guard(e, win(), 'tabs:toggleMuted')
    tm()?.toggleMuted(Number(id))
  })
  ipcMain.handle('tabs:duplicate', (e, id: number) => {
    guard(e, win(), 'tabs:duplicate')
    return tm()?.duplicate(Number(id))
  })
  ipcMain.handle('tabs:discard', (e, id: number) => {
    guard(e, win(), 'tabs:discard')
    tm()?.discard(Number(id))
  })
  ipcMain.handle('tabs:closeOthers', (e, id: number) => {
    guard(e, win(), 'tabs:closeOthers')
    tm()?.closeOthers(Number(id))
  })
  ipcMain.handle('tabs:closeRight', (e, id: number) => {
    guard(e, win(), 'tabs:closeRight')
    tm()?.closeRight(Number(id))
  })

  // per-site zoom
  ipcMain.handle('tabs:zoom', (e, action: 'in' | 'out' | 'reset') => {
    guard(e, win(), 'tabs:zoom')
    const a = action === 'reset' ? 'reset' : action === 'out' ? 'out' : 'in'
    tm()?.zoomForActive(a)
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

  ipcMain.handle('ai:status', async (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    return aiStatus()
  })

  ipcMain.handle('ai:models', async (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    try {
      return { models: await listModels() }
    } catch (err) {
      return { models: [], error: friendlyError(err) }
    }
  })

  // ---------- AI: model library (add ANY Ollama model in-app) ----------
  ipcMain.handle('models:detailed', async (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    try {
      return { models: await listModelsDetailed() }
    } catch (err) {
      return { models: [], error: friendlyError(err) }
    }
  })

  ipcMain.handle('models:catalog', (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    return { catalog: MODEL_CATALOG }
  })

  ipcMain.handle('models:pull', (e, name: string) => {
    guard(e, win(), 'models:pull')
    const model = String(name || '').trim()
    if (!/^[a-zA-Z0-9._\/:-]{1,120}$/.test(model)) {
      throw new Error('Invalid model name — use an Ollama tag like "qwen3.5:4b"')
    }
    return startPull(model)
  })

  ipcMain.handle('models:pull-cancel', (e, pullId: string) => {
    guard(e, win(), 'models:pull-cancel')
    return cancelPull(String(pullId || ''))
  })

  ipcMain.handle('models:pulls', (e) => {
    guard(e, win(), 'models:pulls')
    return { pulls: activePulls() }
  })

  ipcMain.handle('models:delete', async (e, name: string) => {
    guard(e, win(), 'models:delete')
    await deleteModel(String(name || ''))
    return { ok: true }
  })

  ipcMain.handle('models:show', async (e, name: string) => {
    guard(e, win(), 'models:show')
    return modelInfo(String(name || ''))
  })

  ipcMain.handle('models:ps', async (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    try {
      return { running: await runningModels() }
    } catch {
      return { running: [] }
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

      // which brain answers: local Ollama if reachable, else the opt-in cloud fallback
      let choice: BrainChoice | null = null
      try {
        choice = await resolveBrain()
        if (choice && choice.provider === 'local' && payload.model) {
          choice = { provider: 'local', model: payload.model }
        }
      } catch {
        choice = null
      }
      if (!choice) {
        const msg =
          'No AI brain available — Ollama is not reachable and no cloud fallback is configured. ' +
          'Install Ollama and pull a model, or add a cloud fallback in Settings.'
        if (!sender.isDestroyed()) sender.send('ai:chunk', { requestId, error: msg })
        return { error: msg }
      }

      // page context + per-domain memory notes
      let memoryHost = ''
      let memoryUrl = ''
      let memoryTitle = ''
      const messages: OllamaMessage[] = []
      if (payload.usePageContext) {
        const view = tm()?.activeView()
        if (view) {
          const page = await extractPage(view)
          if (page) {
            let sys = chatWithPageSystem(page)
            if (mergedSettings().pageMemory !== false) {
              const notes = memoryPromptFor(hostOf(page.url))
              if (notes) sys += notes
              memoryHost = hostOf(page.url)
              memoryUrl = page.url
              memoryTitle = page.title
            }
            messages.push({ role: 'system', content: sys })
          }
        }
      }
      messages.push(...payload.messages.slice(-HISTORY_WINDOW))

      let full = ''
      try {
        for await (const delta of streamBrain(choice, messages, ctrl.signal)) {
          full += delta
          if (!sender.isDestroyed()) sender.send('ai:chunk', { requestId, delta })
        }
        // remember this Q/A pair for the site (local page memory)
        if (memoryHost && full.trim() && mergedSettings().pageMemory !== false && !ctrl.signal.aborted) {
          const lastUser = [...payload.messages].reverse().find((m) => m.role === 'user')
          if (lastUser) {
            addMemory({ host: memoryHost, url: memoryUrl, title: memoryTitle, q: lastUser.content, a: full })
          }
        }
        return { content: full, model: choice.model, provider: choice.provider }
      } catch (err) {
        const msg = ctrl.signal.aborted ? 'Aborted.' : brainError(err)
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
  ipcMain.handle('agent:run', async (e, payload: { task: string; record?: boolean }) => {
    guard(e, win(), 'agent:run')
    const manager = tm()
    const view = manager?.activeView()
    if (!manager || !view) throw new Error('No active tab')
    const task = typeof payload === 'string' ? payload : String(payload?.task || '')
    const record = typeof payload === 'object' && payload !== null && Boolean(payload.record)
    // fire and forget — progress streams via 'agent:event'
    agentRunner
      .run(task, view, manager, e.sender, { record })
      .catch((err) => {
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

  // ---------- find in page (Ctrl+F) ----------
  ipcMain.handle('find:start', (e, tabId: number, query: string, forward?: boolean) => {
    guard(e, win(), 'find:start')
    tm()?.find(Number(tabId), String(query || ''), forward !== false)
  })

  ipcMain.handle('find:stop', (e, tabId: number) => {
    guard(e, win(), 'find:stop')
    tm()?.stopFind(Number(tabId))
  })

  // ---------- per-site permissions ----------
  ipcMain.handle('perms:respond', (e, requestId: string, allow: boolean, remember: boolean) => {
    guard(e, win(), 'perms:respond')
    respondPermission(String(requestId || ''), Boolean(allow), Boolean(remember))
  })

  ipcMain.handle('perms:list', (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    return listPermissions()
  })

  ipcMain.handle('perms:revoke', (e, origin: string, permission: string) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    revokePermission(String(origin || ''), String(permission || ''))
  })

  ipcMain.handle('perms:clear', (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    clearPermissions()
  })

  // ---------- page memory (local, per-domain) ----------
  ipcMain.handle('memory:list', (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    return listMemory()
  })

  ipcMain.handle('memory:remove', (e, id: string) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    removeMemory(String(id || ''))
  })

  ipcMain.handle('memory:clear', (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    clearMemory()
  })

  // ---------- agent macros (record / replay) ----------
  ipcMain.handle('macros:list', (e) => {
    guard(e, win(), 'macros:list')
    return listMacros()
  })

  ipcMain.handle('macros:save', (e, payload: { name: string; task: string; steps: MacroStep[] }) => {
    guard(e, win(), 'macros:save')
    const res = saveMacro(payload?.name || '', payload?.task || '', Array.isArray(payload?.steps) ? payload.steps : [])
    if (res.error) throw new Error(res.error)
    return { macro: res.macro }
  })

  ipcMain.handle('macros:delete', (e, id: string) => {
    guard(e, win(), 'macros:delete')
    deleteMacro(String(id || ''))
  })

  ipcMain.handle(
    'macros:update',
    (e, id: string, patch: { name?: string; task?: string; steps?: MacroStep[] }) => {
      guard(e, win(), 'macros:update')
      const res = updateMacro(String(id || ''), patch || {})
      if (res.error) throw new Error(res.error)
      return { macro: res.macro }
    }
  )

  // ---------- downloads ----------
  ipcMain.handle('downloads:cancel', (e, id: string) => {
    guard(e, win(), 'downloads:cancel')
    cancelDownload(String(id || ''))
  })

  ipcMain.handle('downloads:reveal', (e, path: string) => {
    guard(e, win(), 'downloads:reveal')
    revealDownload(String(path || ''))
  })

  // ---------- extensions (unpacked, via electron-chrome-extensions) ----------
  ipcMain.handle('extensions:list', (e) => {
    if (!privileged(e, win())) throw new Error('Unauthorized')
    return listExtensionInfos()
  })

  ipcMain.handle('extensions:add', async (e) => {
    guard(e, win(), 'extensions:add')
    const info = await addExtensionFromDialog()
    return { info }
  })

  ipcMain.handle('extensions:toggle', async (e, path: string) => {
    guard(e, win(), 'extensions:toggle')
    await toggleExtension(String(path || ''))
    return listExtensionInfos()
  })

  ipcMain.handle('extensions:remove', async (e, path: string) => {
    guard(e, win(), 'extensions:remove')
    await removeExtension(String(path || ''))
    return listExtensionInfos()
  })

  ipcMain.handle('macros:run', (e, id: string) => {
    guard(e, win(), 'macros:run')
    const manager = tm()
    const view = manager?.activeView()
    const macro = getMacro(String(id || ''))
    if (!manager || !view) throw new Error('No active tab')
    if (!macro) throw new Error('Macro not found')
    agentRunner.runMacro(macro, view, manager, e.sender).catch((err) => {
      console.error('[macro] crashed', err)
    })
    return { started: true }
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

      const choice = await resolveBrain()
      if (!choice) {
        send({
          error:
            'No AI brain available — Ollama is not reachable and no cloud fallback is configured. Install Ollama and pull a model, or add a cloud fallback in Settings. Showing web results only.'
        })
        return { ok: false }
      }
      for await (const delta of streamBrain(choice, buildSearchMessages(String(payload.q || ''), sources), ctrl.signal)) {
        send({ delta })
      }
      send({ done: true })
      return { ok: true }
    } catch (err) {
      const msg = ctrl.signal.aborted ? 'Aborted.' : brainError(err)
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

function buildSearchMessages(q: string, results: SearchResult[]): OllamaMessage[] {
  const resultsText = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
  return [
    { role: 'system', content: SEARCH_SYSTEM },
    { role: 'user', content: `Question: ${q}\n\nWeb results:\n${resultsText || '(no results found)'}` }
  ]
}

export type { SidebarInject }
