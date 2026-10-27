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
    onBookmarksBar: subscribe('chrome:bookmarksBar'),
    /** v1.5.0 — this window is private (badge + no-history indicator) */
    onPrivate: subscribe('win:private'),
    /** v2.3.0 — menu → open the tab-search overlay (Ctrl+Shift+A) */
    onTabSearchShow: subscribe('tabsearch:show'),
    /** v2.3.0 — password manager save bar prompt */
    onCredPrompt: subscribe('creds:prompt'),
    /** v2.6.0 — live translation progress for aether://translate */
    onTranslateUpdate: subscribe('translate:update')
  },

  tabs: {
    create: (url?: string, opts?: { containerId?: string | null }) =>
      ipcRenderer.invoke('tabs:create', url, opts),
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
    /** v2.4.0 — live thumbnail for the tab-hover preview card (null when unavailable) */
    preview: (id: number) => ipcRenderer.invoke('tabs:preview', id) as Promise<string | null>,
    /** v2.6.0 — cluster the window's ungrouped tabs into topic groups (local embeddings) */
    cluster: () => ipcRenderer.invoke('tabs:cluster') as Promise<{ ok: boolean; error?: string; groups?: number; tabs?: number }>,
    /** v2.6.0 — capture the active tab and open aether://translate */
    translate: () => ipcRenderer.invoke('tabs:translate') as Promise<{ ok: boolean }>,
    /** v1.5.0 — middle-click a bookmarks-bar item: open without activating */
    createBackground: (url: string) => ipcRenderer.invoke('tabs:create-bg', url),
    closeOthers: (id: number) => ipcRenderer.invoke('tabs:closeOthers', id),
    closeRight: (id: number) => ipcRenderer.invoke('tabs:closeRight', id),
    zoom: (action: 'in' | 'out' | 'reset') => ipcRenderer.invoke('tabs:zoom', action),
    /** tab groups (#34) — named, colored, collapsible */
    groupCreate: (name: string, color?: string) => ipcRenderer.invoke('tabs:groupCreate', name, color),
    groupUpdate: (id: string, patch: { name?: string; color?: string; collapsed?: boolean }) =>
      ipcRenderer.invoke('tabs:groupUpdate', id, patch),
    groupDelete: (id: string) => ipcRenderer.invoke('tabs:groupDelete', id),
    groupAssign: (tabId: number, groupId: string | null) => ipcRenderer.invoke('tabs:groupAssign', tabId, groupId),
    /** v2.7.0 — move a live tab into another container's isolated session */
    reopenIn: (tabId: number, containerId: string | null) =>
      ipcRenderer.invoke('tabs:reopenIn', tabId, containerId) as Promise<boolean>
  },

  /** v2.7.0 — container tabs (Firefox-style isolated sessions) */
  containers: {
    list: () =>
      ipcRenderer.invoke('containers:list') as Promise<
        Array<{ id: string; name: string; color: string; proxyUrl: string; timezone: string; builtin: boolean }>
      >,
    create: (name: string, color: string) =>
      ipcRenderer.invoke('containers:create', name, color) as Promise<{ id: string; name: string; color: string } | null>,
    update: (
      id: string,
      patch: { name?: string; color?: string; proxyUrl?: string; timezone?: string }
    ) => ipcRenderer.invoke('containers:update', id, patch) as Promise<{ id: string } | null>,
    remove: (id: string) => ipcRenderer.invoke('containers:delete', id) as Promise<boolean>,
    clearData: (id: string) => ipcRenderer.invoke('containers:clearData', id) as Promise<boolean>
  },

  /** v2.7.0 — IP masquerade (proxy manager / Tor / WebRTC shield) */
  netmask: {
    get: () =>
      ipcRenderer.invoke('netmask:get') as Promise<{ mode: string; proxyUrl: string; webrtcShield: boolean }>,
    set: (patch: { mode?: string; proxyUrl?: string }) =>
      ipcRenderer.invoke('netmask:set', patch) as Promise<{ ok: boolean; error?: string }>,
    checkIp: (target: string) =>
      ipcRenderer.invoke('netmask:checkIp', target) as Promise<{
        ok: boolean
        ip: string
        country: string
        via: string
        error?: string
      }>
  },

  /** v2.8.0 — speed dial (New Tab pinned tiles) */
  dials: {
    list: () =>
      ipcRenderer.invoke('dials:list') as Promise<
        Array<{ id: string; url: string; title: string; ts: number }>
      >,
    add: (url: string, title?: string) =>
      ipcRenderer.invoke('dials:add', url, title) as Promise<{ id: string; url: string; title: string } | null>,
    rename: (id: string, title: string) =>
      ipcRenderer.invoke('dials:rename', id, title) as Promise<boolean>,
    remove: (id: string) => ipcRenderer.invoke('dials:remove', id) as Promise<boolean>
  },

  omnibox: {
    suggest: (q: string) => ipcRenderer.invoke('omnibox:suggest', q)
  },

  /** v2.3.0 — password manager (vault + save bar + blocklist) */
  creds: {
    list: () => ipcRenderer.invoke('creds:list') as Promise<{
      available: boolean
      records: Array<{ id: string; host: string; url?: string; username: string; strong: number; ts: number }>
      blocked: string[]
    }>,
    /** decrypt one saved password on demand (manager page only) */
    reveal: (id: string) => ipcRenderer.invoke('creds:reveal', id) as Promise<string>,
    add: (url: string, username: string, password: string) =>
      ipcRenderer.invoke('creds:add', url, username, password) as Promise<{ ok: boolean; error?: string }>,
    remove: (id: string) => ipcRenderer.invoke('creds:remove', id),
    block: (host: string) => ipcRenderer.invoke('creds:block', host),
    unblock: (host: string) => ipcRenderer.invoke('creds:unblock', host),
    /** answer the save bar: save=true stores it, never=block the site;
     *  usernameOverride applies an edited username before saving */
    respond: (requestId: string, save: boolean, never: boolean, usernameOverride?: string) =>
      ipcRenderer.invoke('creds:respond', requestId, save, never, usernameOverride ?? '')
  },

  /** v2.3.0 — installed web apps (PWA "Install as app") */
  apps: {
    list: () => ipcRenderer.invoke('apps:list') as Promise<
      Array<{ id: string; name: string; shortName: string; url: string; host: string; iconPath?: string; manifest: boolean; createdAt: number }>
    >,
    install: (tabId: number) =>
      ipcRenderer.invoke('apps:install', tabId) as Promise<{ ok: boolean; id?: string; name?: string; error?: string }>,
    launch: (id: string) => ipcRenderer.invoke('apps:launch', id) as Promise<number | null>,
    remove: (id: string) => ipcRenderer.invoke('apps:remove', id) as Promise<boolean>
  },

  /** v2.4.0 build 18 — multi-profiles (registry + switch via relaunch) */
  profiles: {
    list: () =>
      ipcRenderer.invoke('profiles:list') as Promise<{
        profiles: Array<{ id: string; name: string; color: string; createdAt: number; lastUsedAt: number }>
        activeId: string
      }>,
    create: (name: string, color: string) =>
      ipcRenderer.invoke('profiles:create', name, color) as Promise<{ ok: boolean; error?: string }>,
    rename: (id: string, name: string) =>
      ipcRenderer.invoke('profiles:rename', id, name) as Promise<{ ok: boolean; error?: string }>,
    remove: (id: string) => ipcRenderer.invoke('profiles:delete', id) as Promise<{ ok: boolean; error?: string }>,
    /** flushes this session and relaunches into the target profile */
    switch: (id: string) => ipcRenderer.invoke('profiles:switch', id) as Promise<{ ok: boolean; error?: string }>
  },

  /** v2.4.0 build 18 — tab hover preview thumbnails (data URL or null) */
  clipboard: {
    readText: () => ipcRenderer.invoke('ui:clipboard-read') as Promise<string>
  },

  ui: {
    setSidebar: (open: boolean) => ipcRenderer.invoke('ui:setSidebar', open),
    /** v1.5.0 — renderer reports its measured chrome height (bookmarks bar etc.) */
    setChromeHeight: (h: number) => ipcRenderer.invoke('ui:chromeHeight', h),
    /** v1.5.0 — toggle the bookmarks bar everywhere (menu / settings page) */
    setBookmarksBar: (show: boolean) => ipcRenderer.invoke('ui:setBookmarksBar', show),
    /** v1.8.0 (#33) — vertical tabs: renderer reports the left-panel width */
    setVtabWidth: (w: number) => ipcRenderer.invoke('ui:vtabWidth', w)
  },

  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle'),
    close: () => ipcRenderer.invoke('win:close'),
    /** v1.8.0 (#37) — command palette: new private window */
    newPrivate: () => ipcRenderer.invoke('win:newPrivate')
  },

  ai: {
    health: () => ipcRenderer.invoke('ai:health'),
    /** which brains are available: { ollama, cloud } */
    status: () => ipcRenderer.invoke('ai:status'),
    models: () => ipcRenderer.invoke('ai:models'),
    pageContext: () => ipcRenderer.invoke('ai:pageContext'),
    chat: (
      messages: Array<{ role: string; content: string; images?: string[] }>,
      usePageContext: boolean,
      model?: string
    ) => stream('ai:chat', 'ai:chunk', { messages, usePageContext, model }),
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
    sweep: () => ipcRenderer.invoke('perms:sweep'),
    onRequest: subscribe('perm:request')
  },

  /** certificate-exception memory (24h, per host — see main/certs.ts) */
  certs: {
    forget: () => ipcRenderer.invoke('certs:forget')
  },

  /** remembered external-protocol choices (mailto:/magnet: … — extproto.ts) */
  extproto: {
    list: () => ipcRenderer.invoke('extproto:list'),
    forget: () => ipcRenderer.invoke('extproto:forget')
  },

  /** quick notes widget (New Tab v3) */
  notes: {
    get: () => ipcRenderer.invoke('notes:get'),
    set: (text: string) => ipcRenderer.invoke('notes:set', text)
  },

  /** reading list (#46) — saved pages with read/unread + time estimates */
  reading: {
    list: () => ipcRenderer.invoke('reading:list'),
    add: (entry: { url: string; title?: string; words?: number }) => ipcRenderer.invoke('reading:add', entry),
    remove: (url: string) => ipcRenderer.invoke('reading:remove', url),
    toggleRead: (url: string) => ipcRenderer.invoke('reading:toggle', url)
  },

  /** clear browsing data (#63) */
  privacy: {
    clearData: (sel: { kinds: string[]; range: string }) => ipcRenderer.invoke('privacy:clearData', sel)
  },

  /** TL;DR toast (#72) + semantic history (#73) — local-AI features */
  ai2: {
    onTLDR: subscribe('tldr:summary'),
    semSearch: (q: string) => ipcRenderer.invoke('history:sem', q)
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
    /** v2.2.0 — pick a default download directory (returns path or null) */
    chooseDir: () => ipcRenderer.invoke('downloads:chooseDir'),
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
    /** v2.2.0 — import/export (real-browser migration path) */
    importSources: () => ipcRenderer.invoke('bookmarks:importSources') as Promise<
      Array<{ id: string; browser: string; profile: string; path: string; count: number }>
    >,
    importProfile: (id: string) =>
      ipcRenderer.invoke('bookmarks:importProfile', id) as Promise<{ added: number; skipped: number; label: string }>,
    importFile: () =>
      ipcRenderer.invoke('bookmarks:importFile') as Promise<{ added: number; skipped: number; files: number }>,
    export: () => ipcRenderer.invoke('bookmarks:export') as Promise<string | null>,
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
    suggest: (q: string) => ipcRenderer.invoke('internal:suggest', { q }),
    ask: (q: string) => stream('internal:ask', 'search:chunk', { q }),
    defaultBrowser: () => ipcRenderer.invoke('internal:default-browser'),
    setDefaultBrowser: () => ipcRenderer.invoke('internal:set-default-browser'),
    openSystemSettings: () => ipcRenderer.invoke('internal:open-system-settings')
  },

  /** v2.5.0 — reader view (aether://reader pages only, main enforces) */
  reader: {
    get: () => ipcRenderer.invoke('reader:get'),
    fetch: (url: string) => ipcRenderer.invoke('reader:fetch', url)
  },

  /** v2.6.0 — full-page translate (aether://translate pages only, main enforces) */
  translate: {
    get: () => ipcRenderer.invoke('translate:get'),
    run: (langCode: string, model?: string) => ipcRenderer.invoke('translate:run', langCode, model),
    stop: () => ipcRenderer.invoke('translate:stop')
  },

  /** v2.5.0 — task manager (aether://taskmgr pages only, main enforces) */
  taskmgr: {
    snapshot: () => ipcRenderer.invoke('taskmgr:snapshot'),
    kill: (winId: number, tabId: number) => ipcRenderer.invoke('taskmgr:kill', winId, tabId)
  },

  /** v2.5.0 — screenshots (chrome UI + internal pages) */
  shots: {
    take: () => ipcRenderer.invoke('shots:take') as Promise<{ ok: boolean; file?: string; error?: string }>
  }
}

export type AetherApi = typeof api
