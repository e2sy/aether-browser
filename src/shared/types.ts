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
}

export interface TabsState {
  tabs: TabMeta[]
  activeId: number | null
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface Settings {
  model: string | null
  usePageContext: boolean
  confirmAgentActions: boolean
  searchMode: 'ai' | 'google' | 'duckduckgo'
  adblock: boolean
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
  received: number
  total: number
  /** null while the server doesn't send Content-Length */
  percent: number | null
  done: boolean
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
}

export interface Bookmark {
  url: string
  title: string
  ts: number
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
