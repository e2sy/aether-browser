/**
 * Page memory — remembers sidebar conversations per site (100% local, JSON file)
 * so future chats on the same domain start with prior context.
 */
import { randomUUID } from 'node:crypto'
import { JsonStore } from './store'
import type { MemoryEntry } from '../shared/types'

const MAX_TOTAL = 120
const MAX_PER_HOST = 8

const store = new JsonStore<MemoryEntry[]>('page-memory.json', [])

export function addMemory(entry: { host: string; url: string; title: string; q: string; a: string }): void {
  if (!entry.host || !entry.q.trim()) return
  const item: MemoryEntry = {
    id: randomUUID().replace(/-/g, '').slice(0, 12),
    host: entry.host,
    url: entry.url,
    title: entry.title || entry.url,
    q: entry.q.slice(0, 400),
    a: entry.a.slice(0, 600),
    ts: Date.now()
  }
  const rest = store.data.filter((m) => m.host !== item.host)
  const sameHost = [item, ...store.data.filter((m) => m.host === item.host)].slice(0, MAX_PER_HOST)
  store.data = [item, ...rest, ...sameHost.filter((m) => m.id !== item.id)].slice(0, MAX_TOTAL)
  // dedupe + cap, keeping most recent first
  const seen = new Set<string>()
  store.data = store.data.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  store.save()
}

/** Recent memories for a host, newest first. */
export function memoriesForHost(host: string, n = 4): MemoryEntry[] {
  if (!host) return []
  return store.data.filter((m) => m.host === host).slice(0, n)
}

export function listMemory(): MemoryEntry[] {
  return [...store.data].sort((a, b) => b.ts - a.ts)
}

export function removeMemory(id: string): void {
  store.data = store.data.filter((m) => m.id !== id)
  store.save()
}

export function clearMemory(): void {
  store.data = []
  store.save()
}

/** Compact block for the chat system prompt (empty string when nothing to recall). */
export function memoryPromptFor(host: string): string {
  const items = memoriesForHost(host, 4)
  if (!items.length) return ''
  const lines = items.map((m) => `- (${m.title}) Q: ${m.q.replace(/\s+/g, ' ').slice(0, 160)} → A: ${m.a.replace(/\s+/g, ' ').slice(0, 200)}`)
  return `\n\n--- NOTES FROM YOUR PREVIOUS CONVERSATIONS ON ${host} ---\n${lines.join('\n')}\n--- END NOTES ---`
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
