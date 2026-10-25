import { BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { TabManager } from './tabs'
import { resolveInput } from './resolve'
import { entryForSender, applyLayout, allEntries, createBrowserWindow } from './windows'
import { setShowBookmarksBar } from './menu'
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
import { applyAdblockSetting, shieldsState, toggleSiteShields, addFilterList, removeFilterList } from './adblock'
import { defaultBrowserState, setAsDefaultBrowser, openDefaultAppsSettings } from './defaultbrowser'
import { ollamaHealth, listModels, friendlyError, OllamaMessage } from './ollama'
import {
  cancelDownload,
  revealDownload,
  listDownloads,
  pauseDownload,
  resumeDownload,
  redownload,
  removeDownloadRecord,
  clearDownloadHistory
} from './downloads'
import { listModelsDetailed, deleteModel, modelInfo, runningModels } from './ollama'
import { resolveBrain, streamBrain, aiStatus, brainError, BrainChoice } from './brain'
import { addMemory, memoryPromptFor, hostOf, listMemory, removeMemory, clearMemory } from './memory'
import { ENGINE_NAMES, tryEngine, wikiPanel } from './search'
import { normalizeAppearance } from './appearance'
import {
  searchAll,
  instantAnswer,
  evaluateMath,
  mergeSuggestions,
  searchSuggestions
} from './search-engine'
import { resolveBang } from './bangs'
import { instantAnswerV2 } from './instant'
import {
  respondPermission,
  listPermissions,
  revokePermission,
  clearPermissions,
  sweepExpiredGrants
} from './permissions'
import { forgetCertMemos } from './certs'
import { listExternalChoices, forgetExternalChoices } from './extproto'
import { createTray, destroyTray, applyStartupBoost } from './osshell'
import { getNotes, setNotes } from './quicknotes'
import { listReading, addReading, removeReading, toggleReading } from './readinglist'
import { listMacros, saveMacro, deleteMacro, getMacro, updateMacro, exportMacro, importMacro } from './macros'
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
import { googleSearchUrl } from './search'
import { ipcGuardDecision, isAetherInternalSender } from './trust'
import { agentRunner } from './agent/executor'
import { chatWithPageSystem, SEARCH_SYSTEM } from './agent/prompts'
import type { MacroStep } from '../shared/types'

const HISTORY_WINDOW = 20
/** sane bounds for the measured chrome height (tab strip + toolbar + bar) */
const CHROME_MIN = 60
const CHROME_MAX = 600

const aborts = new Map<string, AbortController>()

/** Send a chrome-wide event to every live browser window. */
function broadcastToAll(channel: string, payload: unknown): void {
  for (const entry of allEntries()) {
    if (!entry.win.isDestroyed()) entry.win.webContents.send(channel, payload)
  }
}

/** Guard helper — throws for unauthorized senders so pages can't drive the browser.
 *
 * Trusted senders (see trust.ts for the full policy):
 *   1. The chrome-UI webContents of a registered browser window — proven by
 *      IDENTITY (sender === entry.win.webContents), never by URL. In dev the
 *      UI is served from the Vite dev server (http://localhost:5173/) and in
 *      production from the app bundle (file://…); both must be allowed while
 *      arbitrary pages on those schemes stay rejected.
 *   2. aether:// pages served by our own protocol handler.
 *
 * Regression note: the multi-window refactor dropped the old isChrome() check
 * and left only the aether:// rule, which locked the UI out of its own IPC —
 * "Unauthorized IPC call to omnibox:suggest from http://localhost:5173/" on
 * every keystroke, and a dead Enter key in the address bar. */
function guard(e: IpcMainEvent | IpcMainInvokeEvent, who: string): void {
  let url: string | null = null
  let chromeUi = false
  try {
    url = e.sender.getURL() || null
  } catch {
    url = null
  }
  try {
    const entry = entryForSender(e.sender)
    chromeUi = !!entry && !entry.win.isDestroyed() && entry.win.webContents === e.sender
  } catch {
    chromeUi = false
  }
  if (!ipcGuardDecision(url, chromeUi)) {
    throw new Error(`Unauthorized IPC call to ${who} from ${url || 'unknown'}`)
  }
}

/** Strict aether://-only check for the internal:* handlers (see trust.ts).
 *  Kept as a wrapper so the sender's getURL() can never throw past the guard. */
function isInternal(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  try {
    return isAetherInternalSender(e.sender.getURL())
  } catch {
    return false
  }
}

export function registerIpc(): void {
  // ---------- tabs (routed to the sender's own window) ----------
  ipcMain.handle('tabs:create', (e, url?: string) => {
    guard(e, 'tabs:create')
    return fromSender(e)?.tabs.create(url && /^https?:\/\//i.test(url) ? url : undefined)
  })

  // v1.5.0 — middle-click on the bookmarks bar: open without stealing focus
  ipcMain.handle('tabs:create-bg', (e, url?: string) => {
    guard(e, 'tabs:create-bg')
    const u = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined
    if (u) fromSender(e)?.tabs.create(u, false)
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

  // tab groups (#34) — named, colored, collapsible, saved across restarts
  ipcMain.handle('tabs:groupCreate', (e, name: string, color?: string) => {
    guard(e, 'tabs:groupCreate')
    return fromSender(e)?.tabs.createGroup(String(name || ''), color) ?? null
  })
  ipcMain.handle('tabs:groupUpdate', (e, id: string, patch: { name?: string; color?: string; collapsed?: boolean }) => {
    guard(e, 'tabs:groupUpdate')
    return (
      fromSender(e)?.tabs.updateGroup(String(id || ''), {
        ...(patch && typeof patch === 'object' ? patch : {})
      }) ?? false
    )
  })
  ipcMain.handle('tabs:groupDelete', (e, id: string) => {
    guard(e, 'tabs:groupDelete')
    return fromSender(e)?.tabs.deleteGroup(String(id || '')) ?? false
  })
  ipcMain.handle('tabs:groupAssign', (e, tabId: number, groupId: string | null) => {
    guard(e, 'tabs:groupAssign')
    return (
      fromSender(e)?.tabs.setTabGroup(
        Number(tabId),
        groupId === null || groupId === undefined ? null : String(groupId)
      ) ?? false
    )
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

  // v1.5.0 — renderer measures its chrome (tab strip + toolbar + bookmarks
  // bar); the web-area view must sit exactly below it.
  ipcMain.handle('ui:chromeHeight', (e, h: number) => {
    guard(e, 'ui:chromeHeight')
    const entry = fromSender(e)
    if (!entry) return
    const px = Math.max(CHROME_MIN, Math.min(CHROME_MAX, Math.round(Number(h) || 0)))
    if (px !== entry.chromeH) {
      entry.chromeH = px
      applyLayout(entry)
    }
  })

  // v1.8.0 (#33) — vertical tabs: renderer reports its left-panel width so
  // the web area shifts right by exactly that amount
  ipcMain.handle('ui:vtabWidth', (e, w: number) => {
    guard(e, 'ui:vtabWidth')
    const entry = fromSender(e)
    if (!entry) return
    const px = Math.max(0, Math.min(400, Math.round(Number(w) || 0)))
    if (px !== entry.ui.vtabWidth) {
      entry.ui.vtabWidth = px
      applyLayout(entry)
    }
  })

  // v1.5.0 — toggle the bookmarks bar everywhere (menu checkbox / settings)
  ipcMain.handle('ui:setBookmarksBar', (e, show: boolean) => {
    guard(e, 'ui:setBookmarksBar')
    setShowBookmarksBar(Boolean(show))
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

  // command palette (#37) — spawn a private window from anywhere
  ipcMain.handle('win:newPrivate', (e) => {
    guard(e, 'win:newPrivate')
    createBrowserWindow(undefined, { private: true })
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
    // OS-integration live effects (#28/#29) — tray + login item react instantly
    if (patch.showTray !== undefined) {
      if (patch.showTray) createTray()
      else destroyTray()
    }
    if (patch.startupBoost !== undefined) {
      applyStartupBoost(Boolean(patch.startupBoost))
    }
    // v1.4.0 — normalize the appearance blob and tell every chrome window live
    if (patch.appearance !== undefined) {
      const nextAppearance = normalizeAppearance(patch.appearance, mergedSettings().appearance)
      settings.data = { ...settings.data, appearance: nextAppearance }
      settings.save()
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          try {
            w.webContents.send('appearance:changed', nextAppearance)
          } catch {
            /* window racing shutdown */
          }
        }
      }
    }
    return mergedSettings()
  })

  ipcMain.handle('bookmarks:toggle', (e, entry: { url: string; title: string }) => {
    guard(e, 'bookmarks:toggle')
    const now = toggleBookmark(entry)
    broadcastToAll('bookmarks:changed', {})
    return now
  })
  ipcMain.handle('bookmarks:is', (e, url: string) => isBookmarked(String(url || '')))
  ipcMain.handle('bookmarks:list', (e) => bookmarks.data)
  ipcMain.handle('bookmarks:remove', (e, url: string) => {
    guard(e, 'bookmarks:remove')
    removeBookmark(String(url || ''))
    broadcastToAll('bookmarks:changed', {})
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
  ipcMain.handle('omnibox:suggest', async (e, q: string) => {
    guard(e, 'omnibox:suggest')
    const text = String(q || '')
    const local = searchOmnibox(text, 5)
    // v1.3.0 — remote suggestion feed merged under local matches (fails silent)
    let remote: string[] = []
    if (text.trim().length >= 3) {
      try {
        remote = await searchSuggestions(text, 1500)
      } catch {
        remote = []
      }
    }
    const localTitles = [
      ...local.history.map((h) => h.title || h.url),
      ...local.bookmarks.map((b) => b.title || b.url)
    ]
    return { ...local, suggestions: mergeSuggestions(localTitles, remote, 8) }
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

      // page context + per-domain memory notes (from the sender's own window).
      // Private windows (v1.5.0) get page context but never memory notes/writes.
      let memoryHost = ''
      let memoryUrl = ''
      let memoryTitle = ''
      const messages: OllamaMessage[] = []
      const senderEntry = fromSender(e)
      if (payload.usePageContext) {
        const view = senderEntry?.tabs.activeView()
        if (view) {
          const page = await extractPage(view)
          if (page) {
            let sys = chatWithPageSystem(page)
            if (mergedSettings().pageMemory !== false && !senderEntry?.private) {
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

  // Master Plan #13/#14 — maintenance from Settings → Privacy & security
  ipcMain.handle('perms:sweep', (e) => {
    guard(e, 'perms:sweep')
    return sweepExpiredGrants()
  })

  ipcMain.handle('certs:forget', (e) => {
    guard(e, 'certs:forget')
    return forgetCertMemos()
  })

  // external-protocol handler memory (mailto: etc. — Master Plan #26)
  ipcMain.handle('extproto:list', (e) => {
    guard(e, 'extproto:list')
    return listExternalChoices()
  })

  ipcMain.handle('extproto:forget', (e) => {
    guard(e, 'extproto:forget')
    return forgetExternalChoices()
  })

  // quick notes widget (New Tab v3 — Master Plan #44); internal pages only
  ipcMain.handle('notes:get', (e) => {
    guard(e, 'notes:get')
    return getNotes()
  })

  ipcMain.handle('notes:set', (e, text: string) => {
    guard(e, 'notes:set')
    return setNotes(text)
  })

  // reading list (#46) — internal pages + chrome only (guard covers both)
  ipcMain.handle('reading:list', (e) => {
    guard(e, 'reading:list')
    return listReading()
  })

  ipcMain.handle('reading:add', (e, entry: { url: string; title?: string; words?: number }) => {
    guard(e, 'reading:add')
    return addReading({
      url: String(entry?.url || ''),
      title: entry?.title ? String(entry.title) : undefined,
      words: Number.isFinite(Number(entry?.words)) ? Number(entry?.words) : undefined
    })
  })

  ipcMain.handle('reading:remove', (e, url: string) => {
    guard(e, 'reading:remove')
    return removeReading(String(url || ''))
  })

  ipcMain.handle('reading:toggle', (e, url: string) => {
    guard(e, 'reading:toggle')
    return toggleReading(String(url || ''))
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

  // v1.5.0 — the aether://downloads page
  ipcMain.handle('downloads:list', (e) => {
    guard(e, 'downloads:list')
    return listDownloads()
  })
  ipcMain.handle('downloads:pause', (e, id: string) => {
    guard(e, 'downloads:pause')
    pauseDownload(String(id || ''))
  })
  ipcMain.handle('downloads:resume', (e, id: string) => {
    guard(e, 'downloads:resume')
    resumeDownload(String(id || ''))
  })
  ipcMain.handle('downloads:redownload', (e, id: string) => {
    guard(e, 'downloads:redownload')
    return redownload(String(id || ''))
  })
  ipcMain.handle('downloads:remove-record', (e, id: string) => {
    guard(e, 'downloads:remove-record')
    removeDownloadRecord(String(id || ''))
  })
  ipcMain.handle('downloads:clear', (e) => {
    guard(e, 'downloads:clear')
    clearDownloadHistory()
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

  // Default-browser card (Settings) + system settings pane
  ipcMain.handle('internal:default-browser', (e) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    return defaultBrowserState()
  })
  ipcMain.handle('internal:set-default-browser', (e) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    return setAsDefaultBrowser()
  })
  ipcMain.handle('internal:open-system-settings', (e) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    return openDefaultAppsSettings()
  })

  // Error-page recovery: "Turn off ad blocker & retry" — persists the setting
  // (so the Settings page and next boot agree) and reloads the failed URL.
  ipcMain.handle('internal:disable-adblock', (e, url: string) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    settings.data = { ...DEFAULT_SETTINGS, ...settings.data, adblock: false }
    settings.save()
    void applyAdblockSetting(false)
    console.log('[adblock] disabled from the error-page recovery button')
    const target = String(url || '')
    if (/^https?:\/\//i.test(target)) e.sender.loadURL(target)
    return mergedSettings()
  })

  // ---- AETHER SHIELDS (v1.2.0) ------------------------------------------
  // Toolbar popup: live state for the current site + per-site toggle.
  // The URL comes from the UI's own tab record, so the guard is the
  // chrome-UI identity check (web pages can never call these).
  ipcMain.handle('shields:state', (e, pageUrl?: string) => {
    guard(e, 'shields:state')
    return shieldsState(typeof pageUrl === 'string' ? pageUrl : '')
  })

  ipcMain.handle('shields:toggle-site', async (e, pageUrl: string, on: boolean) => {
    guard(e, 'shields:toggle-site')
    await toggleSiteShields(String(pageUrl || ''), Boolean(on))
    return mergedSettings()
  })

  // Settings page: custom filter list management (strict aether-only pages).
  ipcMain.handle('internal:adblock-lists', (e) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    return shieldsState('')
  })

  ipcMain.handle('internal:adblock-add-list', async (e, url: string) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    return addFilterList(String(url || ''))
  })

  ipcMain.handle('internal:adblock-remove-list', async (e, url: string) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    await removeFilterList(String(url || ''))
    return mergedSettings()
  })

  ipcMain.handle('internal:instant', (e, payload: { q: string }) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    const q = String(payload?.q || '')
    // v1.6.0: bangs resolve before everything — `!yt cats` is navigation, not a search
    const bang = resolveBang(q)
    if (bang) return { kind: 'bang', input: q, output: bang.query || bang.name, url: bang.url, name: bang.name }
    return instantAnswerV2(q, { evaluateMath })
  })

  // v1.6.0: live suggestions for the search page dropdown (remote ac feed,
  // fails silent+empty — the page merges its own history locally)
  ipcMain.handle('internal:suggest', async (e, payload: { q: string }) => {
    if (!isInternal(e)) throw new Error('Unauthorized')
    return searchSuggestions(String(payload?.q || ''))
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
      let stats: Array<{ source: string; count: number; ms: number; error?: string }> = []
      // v1.6.0: knowledge panel + related searches run ALONGSIDE the sources,
      // neither can slow the other down; both fail silent
      const query = String(payload.q || '')
      const panelP = wikiPanel(query)
      const relatedP = searchSuggestions(query).then((s) => s.filter((x) => x.toLowerCase() !== query.toLowerCase()).slice(0, 8))
      try {
        // v1.3.0 Aether Search — every source in parallel, own ranking + badges
        const outcome = await searchAll(query, (src) => tryEngine(src, query), ENGINE_NAMES)
        sources = outcome.aggregated
        stats = outcome.stats
      } catch (err) {
        send({
          error:
            'Web search failed: ' +
            (err instanceof Error ? err.message : String(err)) +
            ' — you can still open this search on Google below.',
          googleFallback: googleSearchUrl(query)
        })
        sources = []
      }
      const [panel, related] = await Promise.all([panelP, relatedP])
      send({ sources, stats, ...(panel ? { panel } : {}), ...(related.length ? { related } : {}) })

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
