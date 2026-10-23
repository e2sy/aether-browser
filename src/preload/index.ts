import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

/**
 * Secure bridge. The renderer (chrome UI and internal pages) only ever sees
 * this API — never require(), never remote. Tab/agent channels are additionally
 * guarded main-side by sender checks.
 */

function subscribe(channel: string): (cb: (data: unknown) => void) => () => void {
  return (cb: (data: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, data: unknown): void => cb(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

function rid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Generic invoke + streamed-chunks helper (chat, search). */
function stream(invokeChannel: string, chunkChannel: string, payload: Record<string, unknown>): {
  requestId: string
  onData: (cb: (chunk: Record<string, unknown>) => void) => void
  result: Promise<Record<string, unknown>>
} {
  const requestId = rid()
  const handlers = new Set<(chunk: Record<string, unknown>) => void>()
  const result = ipcRenderer
    .invoke(invokeChannel, { ...payload, requestId })
    .then((r) => (r && typeof r === 'object' ? r : {}))
    .catch((err) => ({ error: String(err?.message || err) }))

  const listener = (_e: IpcRendererEvent, chunk: Record<string, unknown>): void => {
    if (chunk && chunk.requestId === requestId) handlers.forEach((h) => h(chunk))
  }
  ipcRenderer.on(chunkChannel, listener)
  void result.finally(() => ipcRenderer.removeListener(chunkChannel, listener))

  return {
    requestId,
    onData: (cb) => handlers.add(cb),
    result
  }
}

const api = {
  platform: process.platform,

  state: {
    subscribe: subscribe('tabs:state'),
    onMaximized: subscribe('win:maximized'),
    onSidebarInject: subscribe('sidebar:inject')
  },

  tabs: {
    create: (url?: string) => ipcRenderer.invoke('tabs:create', url),
    list: () => ipcRenderer.invoke('tabs:list'),
    omnibox: (id: number, text: string) => ipcRenderer.invoke('tabs:omnibox', id, text),
    close: (id: number) => ipcRenderer.invoke('tabs:close', id),
    activate: (id: number) => ipcRenderer.invoke('tabs:activate', id),
    back: (id: number) => ipcRenderer.invoke('tabs:back', id),
    forward: (id: number) => ipcRenderer.invoke('tabs:forward', id),
    reload: (id: number) => ipcRenderer.invoke('tabs:reload', id),
    stop: (id: number) => ipcRenderer.invoke('tabs:stop', id)
  },

  ui: {
    setSidebar: (open: boolean) => ipcRenderer.invoke('ui:setSidebar', open)
  },

  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle'),
    close: () => ipcRenderer.invoke('win:close')
  },

  ai: {
    health: () => ipcRenderer.invoke('ai:health'),
    models: () => ipcRenderer.invoke('ai:models'),
    pageContext: () => ipcRenderer.invoke('ai:pageContext'),
    chat: (messages: Array<{ role: string; content: string }>, usePageContext: boolean, model?: string) =>
      stream('ai:chat', 'ai:chunk', { messages, usePageContext, model }),
    abort: (requestId: string) => ipcRenderer.invoke('ai:abort', requestId)
  },

  agent: {
    run: (task: string) => ipcRenderer.invoke('agent:run', task),
    respond: (requestId: string, approved: boolean) => ipcRenderer.invoke('agent:respond', requestId, approved),
    cancel: (requestId: string) => ipcRenderer.invoke('agent:cancel', requestId),
    onEvent: subscribe('agent:event')
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch)
  },

  bookmarks: {
    toggle: (entry: { url: string; title: string }) => ipcRenderer.invoke('bookmarks:toggle', entry),
    is: (url: string) => ipcRenderer.invoke('bookmarks:is', url),
    list: () => ipcRenderer.invoke('bookmarks:list')
  },

  internal: {
    search: (q: string) => ipcRenderer.invoke('internal:search', q),
    open: (url: string) => ipcRenderer.invoke('internal:open', url),
    startup: () => ipcRenderer.invoke('internal:startup'),
    ask: (q: string) => stream('internal:ask', 'search:chunk', { q })
  }
}

contextBridge.exposeInMainWorld('aether', api)

export type AetherApi = typeof api
