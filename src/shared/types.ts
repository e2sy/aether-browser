// Shared types used by main, preload and renderer processes.

export interface TabMeta {
  id: number
  title: string
  url: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
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
