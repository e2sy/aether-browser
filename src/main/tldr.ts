/**
 * TL;DR on-load (Master Plan Phase 4, item #72) — opt-in per site.
 *
 * The user lists hosts in Settings; when a page from one of them finishes
 * loading, Aether asks the LOCAL model for a 3-bullet summary and pushes it
 * to the chrome UI as a dismissible toast. Private windows are skipped (the
 * summarization would put their titles into the model context — harmless,
 * but "private means private" is the better default).
 *
 * Pure host matching is unit-tested; the Electron half is one async fn.
 */
import { mergedSettings } from './store'
import { resolveBrain, brainError } from './brain'
import { chatOnce } from './ollama'
import type { TabManager } from './tabs'
import type { WebContents } from 'electron'

/** Pure: does this host match the user's TL;DR list (www-stripped, exact)? */
export function hostMatchesTldr(host: string, hosts: unknown): boolean {
  if (!Array.isArray(hosts) || !hosts.length) return false
  const h = String(host || '').toLowerCase().replace(/^www\./, '')
  if (!h) return false
  return hosts.some((x) => String(x).trim().toLowerCase().replace(/^www\./, '') === h)
}

export const TLDR_SYSTEM =
  'You are Aether\'s TL;DR. Summarize the page in EXACTLY 3 short bullets (each under 18 words). No preamble, no closing remarks. Plain text bullets starting with "- ".'

/** In-flight guard: one summary per tab at a time. */
const busy = new Set<number>()

/**
 * Fire-and-forget: summarize a freshly loaded page for the TL;DR toast.
 * Never throws; silently skips when the host is not opted in.
 */
export async function maybeSummarizePage(tm: TabManager, tabId: number, wc: WebContents): Promise<void> {
  try {
    if (busy.has(tabId) || wc.isDestroyed()) return
    const url = wc.getURL()
    if (!/^https?:\/\//i.test(url)) return
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      return
    }
    const s = mergedSettings() as { tldrHosts?: unknown }
    if (!hostMatchesTldr(host, s.tldrHosts)) return

    busy.add(tabId)
    try {
      const text = await wc.executeJavaScript(
        'document.body ? String(document.body.innerText || "").slice(0, 9000) : ""',
        true
      )
      if (!text || String(text).length < 400 || wc.isDestroyed()) return
      const choice = await resolveBrain()
      if (!choice) return
      const res = await chatOnce(choice.model, [
        { role: 'system', content: TLDR_SYSTEM },
        { role: 'user', content: String(text) }
      ])
      const summary = res?.message?.content || ''
      if (!summary || wc.isDestroyed()) return
      tm.sendToChrome('tldr:summary', {
        tabId,
        url,
        title: wc.getTitle(),
        summary: String(summary).trim().slice(0, 1200),
        ts: Date.now()
      })
    } finally {
      busy.delete(tabId)
    }
  } catch (err) {
    if (err instanceof Error && brainError(err)) return
    /* TL;DR is a nicety — failures are silent */
  }
}
