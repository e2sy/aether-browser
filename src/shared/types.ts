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

export type AgentEventType = 'start' | 'step' | 'confirm' | 'ask_user' | 'done' | 'error' | 'cancelled'

export interface AgentEvent {
  requestId: string
  type: AgentEventType
  tool?: string
  args?: ToolCallArgs
  data?: unknown
}
