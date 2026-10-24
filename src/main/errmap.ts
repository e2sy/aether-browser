/**
 * Load-failure mapping — pure helpers for turning WebContents load failures
 * into a visible, actionable error page.
 *
 * v1.1.6 regression this fixes: `did-fail-load` only renamed the tab title and
 * logged to the dev console, so ANY main-frame failure (network down, DNS
 * blocked, the ad blocker cancelling the document, page crash) left the tab
 * showing an infinite blank view — "the website can't load" with zero
 * explanation. Failures now navigate the tab to aether://error?… which renders
 * the reason plus Retry / disable-ad-blocker recovery buttons.
 */

/** Sentinel code used when the renderer process itself crashed. */
export const CRASH_CODE = -1000

/**
 * Should this did-fail-load event be surfaced as an error page?
 * - subframe failures never replace the page
 * - ERR_ABORTED (-3) is what a superseded/stopped navigation reports — not an error
 * - code 0 is a non-network abort, likewise ignorable
 */
export function shouldShowErrorPage(code: number, isMainFrame: boolean): boolean {
  return isMainFrame && code !== -3 && code !== 0
}

/** Matches both aether://error?… and Chromium's normalized aether://error/?… */
const ERROR_URL_RE = /^aether:\/\/error\/?\?/

/**
 * Build the aether://error URL for a failed navigation. `u` keeps the original
 * target (the omnibox keeps showing the site the user wanted), `c`/`d` carry
 * the raw Electron error code and description. If the input already IS an
 * error page URL it is returned unchanged (no recursive error pages).
 */
export function errorPageUrl(originalUrl: string, code: number, desc: string): string {
  const url = String(originalUrl || '')
  if (ERROR_URL_RE.test(url)) return url
  return (
    'aether://error?u=' +
    encodeURIComponent(url) +
    '&c=' +
    String(code) +
    '&d=' +
    encodeURIComponent(String(desc || ''))
  )
}

/**
 * Map a (possibly error-page) URL back to the URL the user actually asked
 * for. Non-error URLs pass through unchanged — so did-navigate handlers can
 * apply it blindly and the omnibox never shows aether://error?….
 */
export function originalUrlFromErrorPage(url: string): string {
  const raw = String(url || '')
  if (!ERROR_URL_RE.test(raw)) return raw
  try {
    const u = new URL(raw)
    const original = u.searchParams.get('u') || ''
    return original
  } catch {
    return raw
  }
}

/** True when the URL points at the internal error page. */
export function isErrorPageUrl(url: string): boolean {
  return ERROR_URL_RE.test(String(url || ''))
}
