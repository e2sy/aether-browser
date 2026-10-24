import { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { TabManager } from './tabs'
import { resolveInput } from './resolve'
import { entryForSender, applyLayout } from './windows'
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
import { ollamaHealth, listModels, friendlyError, OllamaMessage } from './ollama'
import { listModelsDetailed, deleteModel, modelInfo, runningModels } from './ollama'
import { resolveBrain, streamBrain, aiStatus, brainError, BrainChoice } from './brain'
import { addMemory, memoryPromptFor, hostOf, listMemory, removeMemory, clearMemory } from './memory'
import {
  respondPermission,
  listPermissions,
  revokePermission,
  clearPermissions
} from './permissions'
import { listMacros, saveMacro, deleteMacro, getMacro, updateMacro, exportMacro, importMacro } from './macros'
import { cancelDownload, revealDownload } from './downloads'
import {
  listExtensionInfos,
  addExtensionFromDialog,
  toggleExtension,
  removeExtension
} from './extensions'
import { installExtensionFromDialog, installExtensionFromFile } from './crx'
import { MODEL_CATALOG } from './model-catalog'
import { startPull, cancelPull, activePulls } from './model-manager'
import { extractPage } from './extract'
import { webSearch, googleSearchUrl } from './search'
import { agentRunner } from './agent/executor'
import { chatWithPageSystem, SEARCH_SYSTEM } from './agent/prompts'
import type { MacroStep } from '../shared/types'

const HISTORY_WINDOW = 20

const aborts = new Map<string, AbortController>()

function isInternal(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  try {
    return (e.sender.getURL() || '').startsWith('aether://')
  } catch {
    return false
  }
}

/** Guard helper — throws for unauthorized senders so pages can't drive the browser. */
function guard(e: IpcMainEvent | IpcMainInvokeEvent, who: string): void {
  try {
    if (isInternal(e)) return
  } catch {
    /* fall through */
  }
  throw new Error(`Unauthorized IPC call to ${who} from ${e.sender.getURL() || 'unknown'}`)
}

export function registerIpc(): void {
  // ---------- tabs (routed to the sender's own window) ----------
  ipcMain.handle('tabs:create', (e, url?: string) => {
    guard(e, 'tabs:create')
    return fromSender(e)?.tabs.create(url && /^https?:\/\//i.test(url) ? url : undefined)
  })

  ipcMain.handle('tabs:list', (e) => {
    guard(e, 'tabs:list')
    return fromSender(e)?.tabs.getState()
  })

  ipcMain.handle('tabs:omnibox', (e, id: number, text: string) => {
    guard(e, 'tabs:omnibox')
    fromSender(e)?.tabs.navigate(Number(id), String(text || ''))
  })

  const simple = (channel: string, fn: (m: TabManager, id: number) => void): void => {
    ipcMain.handle(channel, (e, id: number) => {
      guard(e, channel)
      const entry = fromSender(e)
      if (entry) fn(entry.tabs, Number(id))
    })
  }
  simple('tabs:close', (m, id) => m.close(id))
  simple('tabs:activate', (m, id) => m.activate(id))
  simple('tabs:back', (m, id) => m.back(id))
  simple('tabs:forward', (m, id) => m.forward(id))
  simple('tabs:reload', (m, id) => m.reload(id))
  simple('tabs:stop', (m, id) => m.stop(id))

  ipcMain.handle('tabs:reorder', (e, from: number, to: number) => {
    guard(e, 'tabs:reorder')
    fromSender(e)?.tabs.reorder(Number(from), Number(to))
  })

  // tab extras: pin / mute / duplicate / discard / hibernate / popout / bulk close
  ipcMain.handle('tabs:setPinned', (e, id: number, pinned: boolean) => {
    guard(e, 'tabs:setPinned')
    fromSender(e)?.tabs.setPinned(Number(id), Boolean(pinned))
  })
  ipcMain.handle('tabs:toggleMuted', (e, id: number) => {
    guard(e, 'tabs:toggleMuted')
    fromSender(e)?.tabs.toggleMuted(Number(id))
  })
  ipcMain.handle('tabs:duplicate', (e, id: number) => {
    guard(e, 'tabs:duplicate')
    return fromSender(e)?.tabs.duplicate(Number(id))
  })
  ipcMain.handle('tabs:discard', (e, id: number) => {
    guard(e, 'tabs:discard')
    fromSender(e)?.tabs.discard(Number(id))
  })
  ipcMain.handle('tabs:hibernate', (e, id: number) => {
    guard(e, 'tabs:hibernate')
    fromSender(e)?.tabs.toggleHibernated(Number(id))
  })
  ipcMain.handle('tabs:popout', (e, id: number) => {
    guard(e, 'tabs:popout')
    fromSender(e)?.tabs.popout(Number(id))
  })
  ipcMain.handle('tabs:closeOthers', (e, id: number) => {
    guard(e, 'tabs:closeOthers')
    fromSender(e)?.tabs.closeOthers(Number(id))
  })
  ipcMain.handle('tabs:closeRight', (e, id: number) => {
    guard(e, 'tabs:closeRight')
    fromSender(e)?.tabs.closeRight(Number(id))
  })

  // per-site zoom
  ipcMain.handle('tabs:zoom', (e, action: 'in' | 'out' | 'reset') => {
    guard(e, 'tabs:zoom')
    const a = action === 'reset' ? 'reset' : action === 'out' ? 'out' : 'in'
    fromSender(e)?.tabs.zoomForActive(a)
  })

  // ---------- window chrome ----------
  ipcMain.handle('ui:setSidebar', (e, open: boolean) => {
    guard(e, 'ui:setSidebar')
    const entry = fromSender(e)
    if (!entry) return
    entry.ui.sidebarOpen = Boolean(open)
    applyLayout(entry)
  })

  ipcMain.handle('win:minimize', (e) => {
    guard(e, 'win:minimize')
    fromSender(e)?.win.minimize()
  })
  ipcMain.handle('win:maximizeToggle', (e) => {
    guard(e, 'win:maximizeToggle')
    const entry = fromSender(e)
    if (!entry) return
    if (entry.win.isMaximized()) entry.win.unmaximize()
    else entry.win.maximize()
  })
  ipcMain.handle('win:close', (e) => {
    guard(e, 'win:close')
    fromSender(e)?.win.close()
  })

  // ---------- settings / bookmarks / history ----------
  ipcMain.handle('settings:get', (e) => {
    guard(e, 'settings:get')
    return mergedSettings()
  })
  ipcMain.handle('settings:set', (e, patch: Partial<Settings>) => {
    guard(e, 'settings:set')
    settings.data = { ...DEFAULT_SETTINGS, ...settings.data, ...patch }
    settings.save()
    if (patch.adblock !== undefined) {
      void applyAdblockSetting(Boolean(patch.adblock))
    }
    return mergedSettings()
  })

  ipcMain.handle('bookmarks:toggle', (e, entry: { url: string; title: string }) => {
    guard(e, 'bookmarks:toggle')
    return toggleBookmark(entry)
  })
  ipcMain.handle('bookmarks:is', (e, url: string) => isBookmarked(String(url || '')))
  ipcMain.handle('bookmarks:list', (e) => bookmarks.data)
  ipcMain.handle('bookmarks:remove', (e, url: string) => {
    guard(e, 'bookmarks:remove')
    removeBookmark(String(url || ''))
  })
  ipcMain.handle('bookmarks:search', (e, q: string) => {
    guard(e, 'bookmarks:search')
    return searchBookmarks(String(q || ''), 300)
  })
  ipcMain.handle('history:recent', (e) => {
    guard(e, 'history:recent')
    return recentHistory(30)
  })
  ipcMain.handle('history:search', (e, q: string) => {
    guard(e, 'history:search')
    return searchHistory(String(q || ''), 300)
  })
  ipcMain.handle('history:remove', (e, url: string) => {
    guard(e, 'history:remove')
    deleteHistory(String(url || ''))
  })
  ipcMain.handle('history:clear', (e) => {
    guard(e, 'history:clear')
    clearHistory()
  })
  ipcMain.handle('omnibox:suggest', (e, q: string) => {
    guard(e, 'omnibox:suggest')
    return searchOmnibox(String(q || ''), 5)
  })

  // ---------- AI: health / models (chrome + internal pages only) ----------
  ipcMain.handle('ai:health', async (e) => {
    guard(e, 'ai:health')
    return { ok: await ollamaHealth() }
  })

  ipcMain.handle('ai:status', async (e) => {
    guard(e, 'ai:status')
    return aiStatus()
  })

  ipcMain.handle('ai:models', async (e) => {
    guard(e, 'ai:models')
    try {
      return { models: await listModels() }
    } catch (err) {
      return { models: [], error: friendlyError(err) }
    }
  })

  // ---------- AI: model library (add ANY Ollama model in-app) ----------
  ipcMain.handle('models:detailed', async (e) => {
    guard(e, 'models:detailed')
    try {
      return { models: await listModelsDetailed() }
    } catch (err) {
      return { models: [], error: friendlyError(err) }
    }
  })

  ipcMain.handle('models:catalog', (e) => {
    guard(e, 'models:catalog')
    return { catalog: MODEL_CATALOG }
  })

  ipcMain.handle('models:pull', (e, name: string) => {
    guard(e, 'models:pull')
    const model = String(name || '').trim()
    if (!/^[a-zA-Z0-9._\/:-]{1,120}$/.test(model)) {
      throw new Error('Invalid model name — use an Ollama tag like "qwen3.5:4b"')
    }
    return startPull(model)
  })

  ipcMain.handle('models:pull-cancel', (e, pullId: string) => {
    guard(e, 'models:pull-cancel')
    return cancelPull(String(pullId || ''))
  })

  ipcMain.handle('models:pulls', (e) => {
    guard(e, 'models:pulls')
    return { pulls: activePulls() }
  })

  ipcMain.handle('models:delete', async (e, name: string) => {
    guard(e, 'models:delete')
    await deleteModel(String(name || ''))
    return { ok: true }
  })

  ipcMain.handle('models:show', async (e, name: string) => {
    guard(e, 'models:show')
    return modelInfo(String(name || ''))
  })

  ipcMain.handle('models:ps', async (e) => {
    guard(e, 'models:ps')
    try {
      return { running: await runningModels() }
    } catch {
      return { running: [] }
    }
  })

  ipcMain.handle('ai:pageContext', async (e) => {
    guard(e, 'ai:pageContext')
    const view = fromSender(e)?.tabs.activeView()
    if (!view) return null
    return extractPage(view)
  })

  ipcMain.handle(
    'ai:chat',
    async (e, payload: { requestId: string; messages: ChatMsg[]; usePageContext?: boolean; model?: string }) => {
      guard(e, 'ai:chat')
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

      // page context + per-domain memory notes (from the sender's own window)
      let memoryHost = ''
      let memoryUrl = ''
      let memoryTitle = ''
      const messages: OllamaMessage[] = []
      if (payload.usePageContext) {
        const view = fromSender(e)?.tabs.activeView()
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
    guard(e, 'ai:abort')
    aborts.get(String(requestId))?.abort()
  })

  // ---------- AI: agent ----------
  ipcMain.handle('agent:run', async (e, payload: { task: string; record?: boolean }) => {
    guard(e, 'agent:run')
    const entry = fromSender(e)
    const view = entry?.tabs.activeView()
    if (!entry || !view) throw new Error('No active tab')
    const task = typeof payload === 'string' ? payload : String(payload?.task || '')
    const record = typeof payload === 'object' && payload !== null && Boolean(payload.record)
    // fire and forget — progress streams via 'agent:event'
    agentRunner
      .run(task, view, entry.tabs, e.sender, { record })
      .catch((err) => {
        console.error('[agent] crashed', err)
      })
    return { started: true }
  })

  ipcMain.handle('agent:respond', (e, requestId: string, approved: boolean) => {
    guard(e, 'agent:respond')
    agentRunner.respondConfirm(String(requestId), Boolean(approved))
  })

  ipcMain.handle('agent:answer', (e, requestId: string, text: string) => {
    guard(e, 'agent:answer')
    agentRunner.answer(String(requestId), String(text || ''))
  })

  ipcMain.handle('agent:cancel', (e, requestId: string) => {
    guard(e, 'agent:cancel')
    agentRunner.cancel(String(requestId))
  })

  // ---------- find in page (Ctrl+F) ----------
  ipcMain.handle('find:start', (e, tabId: number, query: string, forward?: boolean) => {
    guard(e, 'find:start')
    fromSender(e)?.tabs.find(Number(tabId), String(query || ''), forward !== false)
  })

  ipcMain.handle('find:stop', (e, tabId: number) => {
    guard(e, 'find:stop')
    fromSender(e)?.tabs.stopFind(Number(tabId))
  })

  // ---------- per-site permissions ----------
  ipcMain.handle('perms:respond', (e, requestId: string, allow: boolean, remember: boolean) => {
    guard(e, 'perms:respond')
    respondPermission(String(requestId || ''), Boolean(allow), Boolean(remember))
  })

  ipcMain.handle('perms:list', (e) => {
    guard(e, 'perms:list')
    return listPermissions()
  })

  ipcMain.handle('perms:revoke', (e, origin: string, permission: string) => {
    guard(e, 'perms:revoke')
    revokePermission(String(origin || ''), String(permission || ''))
  })

  ipcMain.handle('perms:clear', (e) => {
    guard(e, 'perms:clear')
    clearPermissions()
  })

  // ---------- page memory (local, per-domain) ----------
  ipcMain.handle('memory:list', (e) => {
    guard(e, 'memory:list')
    return listMemory()
  })

  ipcMain.handle('memory:remove', (e, id: string) => {
    guard(e, 'memory:remove')
    removeMemory(String(id || ''))
  })

  ipcMain.handle('memory:clear', (e) => {
    guard(e, 'memory:clear')
    clearMemory()
  })

  // ---------- agent macros (record / replay / import / export) ----------
  ipcMain.handle('macros:list', (e) => {
    guard(e, 'macros:list')
    return listMacros()
  })

  ipcMain.handle('macros:save', (e, payload: { name: string; task: string; steps: MacroStep[] }) => {
    guard(e, 'macros:save')
    const res = saveMacro(payload?.name || '', payload?.task || '', Array.isArray(payload?.steps) ? payload.steps : [])
    if (res.error) throw new Error(res.error)
    return { macro: res.macro }
  })

  ipcMain.handle('macros:delete', (e, id: string) => {
    guard(e, 'macros:delete')
    deleteMacro(String(id || ''))
  })

  ipcMain.handle(
    'macros:update',
    (e, id: string, patch: { name?: string; task?: string; steps?: MacroStep[] }) => {
      guard(e, 'macros:update')
      const res = updateMacro(String(id || ''), patch || {})
      if (res.error) throw new Error(res.error)
      return { macro: res.macro }
    }
  )

  ipcMain.handle('macros:export', async (e, id: string) => {
    guard(e, 'macros:export')
    const path = await exportMacro(String(id || ''), fromSender(e)?.win)
    return { path }
  })

  ipcMain.handle('macros:import', async (e) => {
    guard(e, 'macros:import')
    const res = await importMacro(fromSender(e)?.win)
    return res
  })

  ipcMain.handle('macros:run', (e, id: string) => {
    guard(e, 'macros:run')
    const entry = fromSender(e)
    const view = entry?.tabs.activeView()
    const macro = getMacro(String(id || ''))
    if (!entry || !view) throw new Error('No active tab')
    if (!macro) throw new Error('Macro not found')
    agentRunner.runMacro(macro, view, entry.tabs, e.sender).catch((err) => {
      console.error('[macro] crashed', err)
    })
    return { started: true }
  })

  // ---------- downloads ----------
  ipcMain.handle('downloads:cancel', (e, id: string) => {
    guard(e, 'downloads:cancel')
    cancelDownload(String(id || ''))
  })

  ipcMain.handle('downloads:reveal', (e, path: string) => {
    guard(e, 'downloads:reveal')
    revealDownload(String(path || ''))
  })

  // ---------- extensions (unpacked + .crx/.zip one-click) ----------
  ipcMain.handle('extensions:list', (e) => {
    guard(e, 'extensions:list')
    return listExtensionInfos()
  })

  ipcMain.handle('extensions:add', async (e) => {
    guard(e, 'extensions:add')
    const info = await addExtensionFromDialog()
    return { info }
  })

  ipcMain.handle('extensions:installFile', async (e) => {
    guard(e, 'extensions:installFile')
    const info = await installExtensionFromDialog(fromSender(e)?.win)
    return { info }
  })

  /** drag & drop install — the renderer resolves the dropped File's path via webUtils */
  ipcMain.handle('extensions:installPath', async (e, path: string) => {
    guard(e, 'extensions:installPath')
    const clean = String(path || '').trim()
    if (!/\.(crx|zip)$/i.test(clean)) throw new Error('Only .crx and .zip packages are supported')
    return installExtensionFromFile(clean)
  })

  ipcMain.handle('extensions:toggle', async (e, path: string) => {
    guard(e, 'extensions:toggle')
    await toggleExtension(String(path || ''))
    return listExtensionInfos()
  })

  ipcMain.handle('extensions:remove', async (e, path: string) => {
    guard(e, 'extensions:remove')
    await removeExtension(String(path || ''))
    return listExtensionInfos()
  })

  // ---------- internal pages (aether://) ----------
  ipcMain.handle('internal:search', (e, q: string) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    const text = String(q || '').trim()
    if (!text) return
    // resolve exactly like the omnibox: "youtube.com" opens the site,
    // plain words run the chosen search (AI page / Google / DuckDuckGo)
    const url = resolveInput(text)
    if (url) e.sender.loadURL(url)
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
        send({
          error:
            'Web search failed: ' +
            (err instanceof Error ? err.message : String(err)) +
            ' — you can still open this search on Google below.',
          googleFallback: googleSearchUrl(String(payload.q || ''))
        })
        sources = []
      }
      send({ sources })

      const choice = await resolveBrain()
      if (!choice) {
        send({
          error:
            'Web results are shown above. The AI answer needs Ollama running — start the Ollama app (check the tray near the clock) and try again. Or open Settings and switch Search mode to Google or DuckDuckGo to search without AI.'
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

// ---------- multi-window routing ----------

function fromSender(e: IpcMainEvent | IpcMainInvokeEvent) {
  const entry = entryForSender(e.sender)
  if (!entry) throw new Error('This window is no longer available')
  return entry
}
