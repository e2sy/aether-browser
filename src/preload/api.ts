import { ipcRenderer, IpcRendererEvent, webUtils } from 'electron'

/**
 * The one and only bridge contract. Exposed as window.aether by BOTH preloads:
 *  - preload/index.ts  (tab views — sandbox:true, so this module must require
 *    nothing but `electron`; node builtins and node_modules are NOT available)
 *  - preload/ui.ts     (chrome UI window — sandbox:false, adds browser-action
 *    injection for electron-chrome-extensions)
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

export const api = {
  platform: process.platform,

  state: {
    subscribe: subscribe('tabs:state'),
    onMaximized: subscribe('win:maximized'),
    onSidebarInject: subscribe('sidebar:inject'),
    onSidebarShow: subscribe('sidebar:show'),
    onFindShow: subscribe('find:show'),
    /** menu → focus the omnibox (works even when a web page has focus) */
    onOmniboxFocus: subscribe('omnibox:focus'),
    /** menu → toggle the AI sidebar (works even when a web page has focus) */
    onSidebarToggle: subscribe('sidebar:toggle'),
    /** per-site zoom feedback for the zoom bubble */
    onZoom: subscribe('zoom:changed'),
    /** download progress for the download bar */
    onDownload: subscribe('download:progress'),
    /** v1.5.0 — bookmarks bar visibility toggled from the menu / settings */
    onBookmarksBar: subscribe('chrome:bookmarksBar')
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
    stop: (id: number) => ipcRenderer.invoke('tabs:stop', id),
    setPinned: (id: number, pinned: boolean) => ipcRenderer.invoke('tabs:setPinned', id, pinned),
    toggleMuted: (id: number) => ipcRenderer.invoke('tabs:toggleMuted', id),
    duplicate: (id: number) => ipcRenderer.invoke('tabs:duplicate', id),
    discard: (id: number) => ipcRenderer.invoke('tabs:discard', id),
    /** tier 1: mute + throttle a background tab (instant wake) */
    hibernate: (id: number) => ipcRenderer.invoke('tabs:hibernate', id),
    /** move a tab out into its own window */
    popout: (id: number) => ipcRenderer.invoke('tabs:popout', id),
    /** v1.5.0 — middle-click a bookmarks-bar item: open without activating */
    createBackground: (url: string) => ipcRenderer.invoke('tabs:create-bg', url),
    closeOthers: (id: number) => ipcRenderer.invoke('tabs:closeOthers', id),
    closeRight: (id: number) => ipcRenderer.invoke('tabs:closeRight', id),
    zoom: (action: 'in' | 'out' | 'reset') => ipcRenderer.invoke('tabs:zoom', action)
  },

  omnibox: {
    suggest: (q: string) => ipcRenderer.invoke('omnibox:suggest', q)
  },

  ui: {
    setSidebar: (open: boolean) => ipcRenderer.invoke('ui:setSidebar', open),
    /** v1.5.0 — renderer reports its measured chrome height (bookmarks bar etc.) */
    setChromeHeight: (h: number) => ipcRenderer.invoke('ui:chromeHeight', h),
    /** v1.5.0 — toggle the bookmarks bar everywhere (menu / settings page) */
    setBookmarksBar: (show: boolean) => ipcRenderer.invoke('ui:setBookmarksBar', show)
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
    update: (id: string, patch: { name?: string; task?: string; steps?: Array<{ tool: string; args: Record<string, unknown> }> }) =>
      ipcRenderer.invoke('macros:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('macros:delete', id),
    run: (id: string) => ipcRenderer.invoke('macros:run', id),
    /** write a macro to a .json file and share it */
    export: (id: string) => ipcRenderer.invoke('macros:export', id),
    /** import a shared .macro.json file */
    import: () => ipcRenderer.invoke('macros:import')
  },

  /** file downloads */
  downloads: {
    cancel: (id: string) => ipcRenderer.invoke('downloads:cancel', id),
    reveal: (path: string) => ipcRenderer.invoke('downloads:reveal', path),
    /** v1.5.0 — aether://downloads page */
    list: () => ipcRenderer.invoke('downloads:list'),
    pause: (id: string) => ipcRenderer.invoke('downloads:pause', id),
    resume: (id: string) => ipcRenderer.invoke('downloads:resume', id),
    redownload: (id: string) => ipcRenderer.invoke('downloads:redownload', id),
    removeRecord: (id: string) => ipcRenderer.invoke('downloads:remove-record', id),
    clear: () => ipcRenderer.invoke('downloads:clear'),
    onChanged: subscribe('downloads:changed')
  },

  /** unpacked Chrome extensions + .crx/.zip one-click install */
  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    add: () => ipcRenderer.invoke('extensions:add'),
    /** install a .crx or .zip package via a file dialog */
    installFile: () => ipcRenderer.invoke('extensions:installFile'),
    /** install a dropped .crx/.zip by absolute path (resolved via webUtils) */
    installPath: (path: string) => ipcRenderer.invoke('extensions:installPath', path),
    toggle: (path: string) => ipcRenderer.invoke('extensions:toggle', path),
    remove: (path: string) => ipcRenderer.invoke('extensions:remove', path)
  },

  /** absolute path of a dropped/picked File object (sandbox-safe) */
  files: {
    pathFor: (file: File) => webUtils.getPathForFile(file)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
    /** v1.4.0 — live appearance updates from the Customization Studio */
    onAppearanceChanged: (cb: (a: unknown) => void) => {
      const listener = (_e: unknown, a: unknown): void => cb(a)
      ipcRenderer.on('appearance:changed', listener)
      return () => ipcRenderer.removeListener('appearance:changed', listener)
    }
  },

  shields: {
    state: (url?: string) => ipcRenderer.invoke('shields:state', url),
    toggleSite: (url: string, on: boolean) => ipcRenderer.invoke('shields:toggle-site', url, on)
  },

  bookmarks: {
    toggle: (entry: { url: string; title: string }) => ipcRenderer.invoke('bookmarks:toggle', entry),
    is: (url: string) => ipcRenderer.invoke('bookmarks:is', url),
    list: () => ipcRenderer.invoke('bookmarks:list'),
    search: (q: string) => ipcRenderer.invoke('bookmarks:search', q),
    remove: (url: string) => ipcRenderer.invoke('bookmarks:remove', url),
    /** v1.5.0 — list changed (toggle/remove anywhere, incl. bookmarks page) */
    onChanged: subscribe('bookmarks:changed')
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
    disableAdblock: (url: string) => ipcRenderer.invoke('internal:disable-adblock', url),
    adblockLists: () => ipcRenderer.invoke('internal:adblock-lists'),
    addAdblockList: (url: string) => ipcRenderer.invoke('internal:adblock-add-list', url),
    removeAdblockList: (url: string) => ipcRenderer.invoke('internal:adblock-remove-list', url),
    instant: (q: string) => ipcRenderer.invoke('internal:instant', { q }),
    ask: (q: string) => stream('internal:ask', 'search:chunk', { q })
  }
}

export type AetherApi = typeof api
