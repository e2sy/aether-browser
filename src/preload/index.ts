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
    onSidebarInject: subscribe('sidebar:inject'),
    onSidebarShow: subscribe('sidebar:show'),
    onFindShow: subscribe('find:show')
  },

  tabs: {
    create: (url?: string) => ipcRenderer.invoke('tabs:create', url),
    list: () => ipcRenderer.invoke('tabs:list'),
    omnibox: (id: number, text: string) => ipcRenderer.invoke('tabs:omnibox', id, text),
    close: (id: number) => ipcRenderer.invoke('tabs:close', id),
    activate: (id: number) => ipcRenderer.invoke('tabs:activate', id),
    reorder: (from: number, to: number) => ipcRenderer.invoke('tabs:reorder', from, to),
    back: (id: number) => ipcRenderer.invoke('tabs:back', id),
    forward: (id: number) => ipcRenderer.invoke('tabs:forward', id),
    reload: (id: number) => ipcRenderer.invoke('tabs:reload', id),
    stop: (id: number) => ipcRenderer.invoke('tabs:stop', id)
  },

  omnibox: {
    suggest: (q: string) => ipcRenderer.invoke('omnibox:suggest', q)
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
    /** which brains are available: { ollama, cloud } */
    status: () => ipcRenderer.invoke('ai:status'),
    models: () => ipcRenderer.invoke('ai:models'),
    pageContext: () => ipcRenderer.invoke('ai:pageContext'),
    chat: (messages: Array<{ role: string; content: string }>, usePageContext: boolean, model?: string) =>
      stream('ai:chat', 'ai:chunk', { messages, usePageContext, model }),
    abort: (requestId: string) => ipcRenderer.invoke('ai:abort', requestId)
  },

  models: {
    /** installed models with size / params / quantization */
    detailed: () => ipcRenderer.invoke('models:detailed'),
    /** curated suggestions for the library UI */
    catalog: () => ipcRenderer.invoke('models:catalog'),
    /** pull ANY model tag — ollama.com/library or hf.co GGUF */
    pull: (name: string) => ipcRenderer.invoke('models:pull', name),
    cancel: (pullId: string) => ipcRenderer.invoke('models:pull-cancel', pullId),
    /** in-flight (and just-finished) pulls, for restoring the UI */
    pulls: () => ipcRenderer.invoke('models:pulls'),
    remove: (name: string) => ipcRenderer.invoke('models:delete', name),
    info: (name: string) => ipcRenderer.invoke('models:show', name),
    running: () => ipcRenderer.invoke('models:ps'),
    onProgress: subscribe('models:pull-progress'),
    onChanged: subscribe('models:changed')
  },

  agent: {
    run: (task: string, record?: boolean) => ipcRenderer.invoke('agent:run', { task, record: Boolean(record) }),
    respond: (requestId: string, approved: boolean) => ipcRenderer.invoke('agent:respond', requestId, approved),
    answer: (requestId: string, text: string) => ipcRenderer.invoke('agent:answer', requestId, text),
    cancel: (requestId: string) => ipcRenderer.invoke('agent:cancel', requestId),
    onEvent: subscribe('agent:event')
  },

  /** Ctrl+F in-page search */
  find: {
    start: (tabId: number, query: string, forward?: boolean) =>
      ipcRenderer.invoke('find:start', tabId, query, forward),
    stop: (tabId: number) => ipcRenderer.invoke('find:stop', tabId),
    onResult: subscribe('find:result')
  },

  /** per-site permission prompts + remembered decisions */
  perms: {
    respond: (requestId: string, allow: boolean, remember: boolean) =>
      ipcRenderer.invoke('perms:respond', requestId, allow, remember),
    list: () => ipcRenderer.invoke('perms:list'),
    revoke: (origin: string, permission: string) => ipcRenderer.invoke('perms:revoke', origin, permission),
    clear: () => ipcRenderer.invoke('perms:clear'),
    onRequest: subscribe('perm:request')
  },

  /** local per-domain page memory */
  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    remove: (id: string) => ipcRenderer.invoke('memory:remove', id),
    clear: () => ipcRenderer.invoke('memory:clear')
  },

  /** recorded agent macros */
  macros: {
    list: () => ipcRenderer.invoke('macros:list'),
    save: (name: string, task: string, steps: Array<{ tool: string; args: Record<string, unknown> }>) =>
      ipcRenderer.invoke('macros:save', { name, task, steps }),
    remove: (id: string) => ipcRenderer.invoke('macros:delete', id),
    run: (id: string) => ipcRenderer.invoke('macros:run', id)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch)
  },

  bookmarks: {
    toggle: (entry: { url: string; title: string }) => ipcRenderer.invoke('bookmarks:toggle', entry),
    is: (url: string) => ipcRenderer.invoke('bookmarks:is', url),
    list: () => ipcRenderer.invoke('bookmarks:list'),
    search: (q: string) => ipcRenderer.invoke('bookmarks:search', q),
    remove: (url: string) => ipcRenderer.invoke('bookmarks:remove', url)
  },

  history: {
    recent: () => ipcRenderer.invoke('history:recent'),
    search: (q: string) => ipcRenderer.invoke('history:search', q),
    remove: (url: string) => ipcRenderer.invoke('history:remove', url),
    clear: () => ipcRenderer.invoke('history:clear')
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
