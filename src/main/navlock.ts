/**
 * navlock — navigation lockdown policy for Aether's own surfaces.
 *
 * Threat model: content that reaches an internal page (search-result
 * snippets, history titles, bookmark names, suggestion rows) should never
 * be able to drive the top frame anywhere. Internal pages are built to
 * navigate ONLY through the `window.aether.internal.open` bridge (which the
 * main process resolves with `webContents.loadURL` — an API that does not
 * emit `will-navigate`). So any in-page navigation attempt on an
 * aether:// page is hostile by definition: a script injection, a forged
 * link, or a form hijack. Block it.
 *
 * On real web pages we are a browser — link clicks and in-page JS may
 * navigate freely. Two exceptions, both classic web-attacks:
 *   - a web page navigating to file:// (intranet/local file exfiltration)
 *   - a web page navigating to devtools: / chrome: -style privileged
 *     schemes it has no business touching
 *
 * The chrome shell (the React window chrome itself) is pure first-party UI:
 * it has zero legitimate reason to navigate anywhere, ever. Lock it fully.
 *
 * Pure and dependency-free — fully unit-tested (test-v172.mjs).
 */

/** Schemes a normal web page may never navigate the top frame to. */
const FORBIDDEN_FROM_WEB = ['file:', 'devtools:', 'chrome:', 'chrome-extension:', 'view-source:', 'javascript:']

/** The chrome UI shell must never navigate — no exceptions. */
export const CHROME_SHELL_LOCK = true as const

/**
 * Decide whether an in-page navigation (the `will-navigate` event) should be
 * blocked. `currentUrl` is the page the navigation happens FROM.
 */
export function shouldBlockWillNavigate(currentUrl: string, targetUrl: string): boolean {
  const from = String(currentUrl || '').toLowerCase()
  const to = String(targetUrl || '').toLowerCase()

  // The chrome shell never navigates, period. (Reloads are issued by the
  // main process, not by in-page behavior, so they are unaffected.)
  if (from.startsWith('file://') || from.includes('/renderer/index.html')) return true

  // Internal pages navigate only via the bridge (main-process loadURL).
  if (from.startsWith('aether://')) return true

  // Web pages: free to navigate, except into privileged/local schemes.
  // Empty/garbage targets fail closed — a navigation with no destination is
  // not a real navigation, and we would rather block a nothing than allow
  // an anything.
  if (!to) return true
  if (to.startsWith('file://')) return true
  for (const scheme of FORBIDDEN_FROM_WEB) {
    if (to.startsWith(scheme)) return true
  }
  return false
}

/** Human-readable reason for a block (used in logs). */
export function blockReason(currentUrl: string, targetUrl: string): string {
  const from = String(currentUrl || '')
  const to = String(targetUrl || '')
  if (from.startsWith('file://') || from.includes('/renderer/index.html')) return 'chrome-shell lockdown'
  if (from.startsWith('aether://')) return 'internal-page lockdown'
  return 'privileged-scheme guard'
}
