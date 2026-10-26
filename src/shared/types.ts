// Shared types used by main, preload and renderer processes.

export interface TabMeta {
  id: number
  title: string
  url: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  muted: boolean
  /** Tab is currently playing audio (blocks memory-saver discard) */
  audible: boolean
  /** Memory saver unloaded this tab — reloads on activation */
  discarded: boolean
  /** Light sleep: muted + throttled at 1 fps — wakes instantly on activation */
  hibernated: boolean
  /** Tab group membership (#34) — null/absent = ungrouped */
  groupId?: string | null
}

export interface TabsState {
  tabs: TabMeta[]
  activeId: number | null
  /** tab groups in strip order (#34) */
  groups?: TabGroupInfo[]
}

/** Serializable group metadata for the renderer + session store. */
export interface TabGroupInfo {
  id: string
  name: string
  color: string
  collapsed: boolean
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface AppearanceSettings {
  /** dark (default) / light / follow the OS */
  theme: 'dark' | 'light' | 'system'
  /** #rrggbb accent used for highlights, buttons, focus rings */
  accent: string
  /** UI zoom for internal pages + chrome (0.85 - 1.25) */
  fontScale: number
  /** new-tab background preset */
  newtabBg: 'aurora' | 'midnight' | 'slate' | 'light' | 'solid'
  /** show the clock + greeting on the new tab */
  newtabClock: boolean
}

export interface Settings {
  model: string | null
  usePageContext: boolean
  confirmAgentActions: boolean
  searchMode: 'ai' | 'google' | 'duckduckgo'
  adblock: boolean
  /** Hosts where the user turned shields off for that site (toolbar popup) */
  shieldsOffHosts: string[]
  /** Aggressive tier: also inject anti-adblock scriptlets (may break heavy SPAs) */
  shieldsAggressive: boolean
  /** Extra filter lists — checked curated preset ids (see shields-core) */
  filterPresetIds: string[]
  /** Extra filter lists — user-supplied https:// URLs to .txt filter files */
  filterLists: string[]
  stripElectronUA: boolean
  /** Remember per-domain notes from sidebar chats and reuse them as context */
  pageMemory: boolean
  /** Optional OpenAI-compatible fallback used when Ollama is unreachable (chat + AI search only) */
  cloudFallback: CloudFallbackConfig
  /** Tiered memory saver: hibernate idle background tabs after N minutes,
   *  fully unload them after 3×N minutes (0 disables the memory saver) */
  memorySaver: number
  /** Unpacked extensions to load at boot */
  extensions: ExtensionRecord[]
  /** v1.4.0 Customization Studio — themes, accent, fonts, new-tab look */
  appearance: AppearanceSettings
  /** v1.5.0 — reopen the tabs/windows from the previous session at boot */
  restoreSession: boolean
  /** v1.5.0 — show the bookmarks bar under the toolbar */
  showBookmarksBar: boolean
  /** v1.7.0 — re-ask remembered site-permission grants after N days (0 = never) */
  grantTtlDays: number
  /** v1.7.0 (#28) — show the quick-actions tray icon (win/linux) */
  showTray: boolean
  /** v1.7.0 (#28) — closing the last window hides to tray instead of quitting */
  closeToTray: boolean
  /** v1.7.0 (#29) — opt-in login item, boots hidden for a warm start */
  startupBoost: boolean
  /** v1.7.0 (#30) — native notification when a download completes */
  notifyDownloads: boolean
  /** v1.8.0 (#33) — tab strip orientation: classic top strip or left panel */
  tabOrientation: 'top' | 'left'
  /** v1.8.0 (#52) — force-dark scheduler: off / always / night (20:00–07:00) */
  forceDarkMode: 'off' | 'always' | 'night'
  /** v1.8.0 (#52) — hosts that get the force-dark inversion */
  forceDarkHosts: string[]
  /** v1.9.0 (#58) — strip utm_…, gclid, fbclid trackers from navigations */
  paramScrubber: boolean
  /** v1.9.0 (#60) — upgrade http navigations to https */
  httpsOnly: boolean
  /** v1.9.0 (#60) — hosts allowed to stay on http */
  httpsExemptHosts: string[]
  /** v1.9.0 (#61) — DNS-over-HTTPS: off / auto (allow fallback) / secure */
  dohMode: 'off' | 'auto' | 'secure'
  /** v1.9.0 (#61) — DoH template URL (Cloudflare/Quad9/Google/custom) */
  dohTemplate: string
  /** v1.9.0 (#68) — cross-origin requests send origin-only referrers */
  referrerTight: boolean
  /** v2.0 (#78) — AI search depth: quick / deep / academic / code */
  searchDepth: 'quick' | 'deep' | 'academic' | 'code'
  /** v2.0 (#72) — hosts that get an automatic TL;DR toast on load */
  tldrHosts: string[]
  /** v2.2.0 — check spelling in form fields (en-US dictionary, right-click fixes) */
  spellcheck: boolean
  /** v2.2.0 — ask where to save each file before downloading (native save dialog) */
  askDownloadLocation: boolean
  /** v2.2.0 — custom download directory ('' = the OS Downloads folder) */
  downloadDir: string
}

/** A loaded unpacked extension (persisted across boots). */
export interface ExtensionRecord {
  path: string
  enabled: boolean
}

/** Info about an installed extension for the settings UI. */
export interface ExtensionInfo {
  id: string
  name: string
  version: string
  path: string
  enabled: boolean
}

/** Live state of a file download, streamed main → renderer. */
export interface DownloadState {
  id: string
  filename: string
  path: string
  /** source URL (v1.5.0 — enables re-download from the downloads page) */
  url?: string
  received: number
  total: number
  /** null while the server doesn't send Content-Length */
  percent: number
  | null
  done: boolean
  /** v1.5.0 — true while paused by the user */
  paused?: boolean
  cancelled?: boolean
  error?: string
}

export interface CloudFallbackConfig {
  enabled: boolean
  /** e.g. https://api.groq.com/openai/v1 */
  baseUrl: string
  apiKey: string
  model: string
}

export interface OmniboxSuggestion {
  kind: 'search' | 'url' | 'history' | 'bookmark'
  label: string
  sub?: string
  value: string
}

export interface PageDoc {
  url: string
  title: string
  markdown: string
}

export interface ElementRef {
  ref: number
  tag: string
  type?: string
  role?: string
  text: string
  placeholder?: string
  value?: string
  href?: string
  /** Stable identity key — same element keeps the same ref across snapshots */
  key?: string
}

export interface PageSnapshot {
  url: string
  title: string
  elements: ElementRef[]
  text: string
}

export interface ToolCallArgs {
  [key: string]: unknown
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** Which upstream fed this result (set by the Aether Search aggregator) */
  source?: string
}

export interface Bookmark {
  url: string
  title: string
  ts: number
  /** v2.2.0 — import origin folder path ("Bookmarks bar / Dev"); absent for Aether-made bookmarks */
  folder?: string
}

/** v2.2.0 — a browser profile on this machine whose bookmarks can be imported. */
export interface ImportSource {
  id: string
  /** Chrome / Edge / Brave / Chromium */
  browser: string
  /** Default, Profile 1, … */
  profile: string
  /** Absolute path of the profile directory (the Bookmarks file lives inside) */
  path: string
  /** Bookmarks found in that profile (quick read at detection time) */
  count: number
}

export interface HistoryEntry {
  url: string
  title: string
  host: string
  ts: number
}

export interface SidebarInject {
  text: string
  focus?: boolean
}

export type SidebarMode = 'chat' | 'agent' | 'models'

/** A model installed in the local Ollama instance (from GET /api/tags). */
export interface OllamaModelInfo {
  name: string
  /** bytes on disk */
  size: number
  /** e.g. "9.2B" */
  parameterSize: string
  /** e.g. "Q4_K_M" */
  quantization: string
  /** e.g. "qwen2" */
  family: string
  modifiedAt: string
}

/** Live progress of a model pull, streamed main → renderer. */
export interface PullProgress {
  pullId: string
  name: string
  status: string
  total: number
  completed: number
  /** 0–100, null while indeterminate (manifest / verify phases) */
  percent: number | null
  done: boolean
  error?: string
  cancelled?: boolean
}

/** Curated entry in the in-app model library. */
export interface CatalogModel {
  name: string
  family: string
  params: string
  disk: string
  ram: string
  blurb: string
  tags: string[]
}

export type AgentEventType = 'start' | 'step' | 'confirm' | 'ask_user' | 'done' | 'error' | 'cancelled'

export interface AgentEvent {
  requestId: string
  type: AgentEventType
  tool?: string
  args?: ToolCallArgs
  data?: unknown
}

/** One recorded agent action — replayable without a model (see Macro). */
export interface MacroStep {
  tool: string
  args: ToolCallArgs
}

export interface Macro {
  id: string
  name: string
  task: string
  steps: MacroStep[]
  createdAt: number
  runs: number
}

/** A remembered page conversation (per-domain local memory). */
export interface MemoryEntry {
  id: string
  host: string
  url: string
  title: string
  q: string
  a: string
  ts: number
}

/** A remembered site permission decision ("https://example.com" + "media"). */
export interface PermissionEntry {
  origin: string
  permission: string
  decision: 'allow' | 'block'
  ts: number
}

/** Progress of an in-page search pushed to the find bar. */
export interface FindResult {
  tabId: number
  active: number
  matches: number
}

/** Which brain answered — local Ollama or the optional cloud fallback. */
export interface AiStatus {
  ollama: boolean
  cloud: boolean
}

/** Request to update an existing macro (macro editor). */
export interface MacroUpdate {
  name?: string
  task?: string
  steps?: MacroStep[]
}

/** On-disk macro file produced by macros:export (also accepted by import). */
export interface MacroFile {
  aetherMacro: 1
  name: string
  task: string
  steps: MacroStep[]
  exportedAt?: number
}

/** Result of installing an extension from a .crx / .zip file. */
export interface ExtensionInstallResult {
  name: string
  path: string
  enabled: boolean
}
