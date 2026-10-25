/**
 * Tab groups (Master Plan Phase 2, item #34) — pure model + rules.
 *
 * A group is { id, name, color, collapsed }. Tabs carry `groupId: string|null`.
 * Rules enforced here (all unit-tested in test-v181.mjs):
 *   • names are trimmed, capped at 40 chars, non-empty after trim
 *   • colors come from a fixed 8-color palette (Chrome's set)
 *   • a tab belongs to at most one group; re-assigning moves it
 *   • deleting a group un-groups its members (never deletes tabs)
 *   • collapsed groups hide their members from the strip (UI concern) —
 *     the model only tracks the flag
 *   • ordering: grouped tabs sort after ungrouped, by group then by tab
 *     order, so a strip renderer can lay them out deterministically
 */
import { randomUUID } from 'node:crypto'

export interface TabGroup {
  id: string
  name: string
  color: TabGroupColor
  collapsed: boolean
}

export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan'

/** Chrome-compatible palette (hex values used by the renderer). */
export const GROUP_COLORS: Readonly<Record<TabGroupColor, string>> = Object.freeze({
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#188038',
  pink: '#d01884',
  purple: '#9334e6',
  cyan: '#007b83'
})

export const MAX_GROUP_NAME = 40

export function isGroupColor(v: unknown): v is TabGroupColor {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(GROUP_COLORS, v)
}

/** Pure: normalize a group name ('' when hostile). */
export function cleanGroupName(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, MAX_GROUP_NAME)
  return s
}

export interface GroupDraft {
  name: string
  color?: unknown
}

/** Pure: create a validated group (throws never — returns null when invalid). */
export function makeGroup(draft: GroupDraft, existing: TabGroup[]): TabGroup | null {
  const name = cleanGroupName(draft?.name)
  if (!name) return null
  const color: TabGroupColor = isGroupColor(draft?.color) ? draft.color : 'blue'
  const dup = existing.some((g) => g.name.toLowerCase() === name.toLowerCase())
  if (dup) return null
  return { id: 'tg_' + randomUUID().replace(/-/g, '').slice(0, 12), name, color, collapsed: false }
}

/** Pure: rename (returns same array unchanged when invalid or duplicate). */
export function renameGroup(groups: TabGroup[], id: string, name: unknown): TabGroup[] {
  const clean = cleanGroupName(name)
  if (!clean) return groups
  if (groups.some((g) => g.id !== id && g.name.toLowerCase() === clean.toLowerCase())) return groups
  return groups.map((g) => (g.id === id ? { ...g, name: clean } : g))
}

export function recolorGroup(groups: TabGroup[], id: string, color: unknown): TabGroup[] {
  if (!isGroupColor(color)) return groups
  return groups.map((g) => (g.id === id ? { ...g, color } : g))
}

export function toggleGroupCollapsed(groups: TabGroup[], id: string, collapsed?: boolean): TabGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, collapsed: typeof collapsed === 'boolean' ? collapsed : !g.collapsed } : g))
}

/** Pure: delete a group — members come back as groupId: null. Returns new groups + new tab map. */
export function deleteGroup(
  groups: TabGroup[],
  id: string,
  tabGroups: Record<string, string | null>
): { groups: TabGroup[]; tabGroups: Record<string, string | null> } {
  const out: Record<string, string | null> = {}
  for (const [tabKey, gid] of Object.entries(tabGroups)) {
    out[tabKey] = gid === id ? null : gid
  }
  return { groups: groups.filter((g) => g.id !== id), tabGroups: out }
}

/**
 * Pure: strip order for a window — ungrouped tabs first (original order),
 * then groups in `groups` order, members in original order inside each.
 * Collapsed groups keep a single representative position (the UI hides
 * members; the model keeps order stable).
 */
export function orderedTabIds(
  order: string[],
  groups: TabGroup[],
  tabGroups: Record<string, string | null>
): string[] {
  const groupIdsInOrder = groups.map((g) => g.id)
  const ungrouped: string[] = []
  const byGroup = new Map<string, string[]>()
  for (const id of order) {
    const gid = tabGroups[id] || null
    if (gid && groupIdsInOrder.includes(gid)) {
      const list = byGroup.get(gid) || []
      list.push(id)
      byGroup.set(gid, list)
    } else {
      ungrouped.push(id)
    }
  }
  const out = [...ungrouped]
  for (const gid of groupIdsInOrder) {
    out.push(...(byGroup.get(gid) || []))
  }
  return out
}

/** Pure: sanitize a groups array read back from disk (fail-closed). */
export function sanitizeGroups(raw: unknown): TabGroup[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TabGroup[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const g = r as { id?: unknown; name?: unknown; color?: unknown; collapsed?: unknown }
    if (typeof g.id !== 'string' || !/^tg_[a-f0-9]{6,16}$/.test(g.id)) continue
    if (seen.has(g.id)) continue
    const name = cleanGroupName(g.name)
    if (!name) continue
    seen.add(g.id)
    out.push({
      id: g.id,
      name,
      color: isGroupColor(g.color) ? g.color : 'blue',
      collapsed: g.collapsed === true
    })
  }
  return out
}
