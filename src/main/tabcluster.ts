/**
 * Smart tab clustering runtime (v2.6.0 build 20) — "Group tabs by topic".
 *
 * Embeds the user's open tabs with the SAME local embedding models the
 * semantic history uses (nomic-embed-text / mxbai / all-minilm), clusters
 * them with the pure policy in shared/tabcluster.ts, then creates REAL tab
 * groups (build 10's model) for every cluster with ≥ minSize members.
 *
 * Scope guards:
 *   • only http(s) tabs are embedded — internal pages would poison clusters
 *   • discarded/hibernated tabs still have titles, so they participate
 *   • only UNGROUPED tabs are touched — manual grouping is never overridden
 *   • hard cap of 60 tabs and 8 groups per run keeps a 9B-embedding box snappy
 */
import type { TabManager } from './tabs'
import { buildTopicGroups, type ClusterInput } from '../shared/tabcluster'
import { pickEmbedModel, embedText } from './semhistory'

export const CLUSTER_MAX_TABS = 60
export const CLUSTER_MIN_SIZE = 3
export const CLUSTER_THRESHOLD = 0.45
export const CLUSTER_MAX_GROUPS = 8

export interface ClusterOutcome {
  ok: boolean
  error?: string
  groups?: number
  tabs?: number
  labels?: string[]
}

/** Collect the clustering candidates of one window (ungrouped http(s) tabs). */
export function clusterCandidates(tm: TabManager): Array<{ id: number; title: string; url: string }> {
  const state = tm.getState()
  const out: Array<{ id: number; title: string; url: string }> = []
  for (const t of state.tabs) {
    if (out.length >= CLUSTER_MAX_TABS) break
    if (!/^https?:/i.test(t.url || '')) continue
    if (t.groupId) continue // respect manual grouping
    out.push({ id: t.id, title: (t.title || '').trim() || t.url, url: t.url })
  }
  return out
}

/**
 * Cluster the window's ungrouped tabs into topic groups. Fails soft with a
 * human message when Ollama / an embedding model is missing.
 */
export async function clusterTabsByTopic(tm: TabManager): Promise<ClusterOutcome> {
  const cands = clusterCandidates(tm)
  if (cands.length < CLUSTER_MIN_SIZE) {
    return { ok: false, error: 'Not enough ungrouped web tabs to cluster (need at least 3).' }
  }
  const model = await pickEmbedModel()
  if (!model) {
    return { ok: false, error: 'Topic grouping needs an embedding model. Run:  ollama pull nomic-embed-text' }
  }

  const items: ClusterInput[] = []
  for (const c of cands) {
    let host = ''
    try {
      host = new URL(c.url).hostname.replace(/^www\./, '')
    } catch {
      /* keep empty host */
    }
    const vec = await embedText(model, `${c.title} ${host}`.slice(0, 512))
    if (vec) items.push({ index: c.id, title: c.title, vec })
  }
  if (items.length < CLUSTER_MIN_SIZE) {
    return { ok: false, error: 'Embedding failed for too many tabs — check that Ollama is running.' }
  }

  const existing = tm.getState().groups?.map((g) => g.name) || []
  const groups = buildTopicGroups(items, CLUSTER_THRESHOLD, CLUSTER_MIN_SIZE, existing).slice(
    0,
    CLUSTER_MAX_GROUPS
  )
  if (!groups.length) {
    return { ok: false, error: 'No clear topics found — open tabs look unrelated.' }
  }

  const palette = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan']
  let assigned = 0
  const labels: string[] = []
  for (const g of groups) {
    const group = tm.createGroup(g.label, palette[g.colorIndex % palette.length])
    if (!group) continue // duplicate name raced — skip rather than mangle
    labels.push(g.label)
    for (const m of g.members) {
      if (tm.setTabGroup(m.index, group.id)) assigned++
    }
  }
  if (!assigned) return { ok: false, error: 'Could not create groups (names may already exist).' }
  return { ok: true, groups: labels.length, tabs: assigned, labels }
}
