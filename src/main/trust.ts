/**
 * IPC trust policy — the single source of truth for which renderers may call
 * the browser's privileged IPC handlers.
 *
 * v1.1.5 regression this module fixes: the multi-window refactor reduced the
 * guard to "sender URL starts with aether://" only. The chrome UI itself does
 * NOT run on aether:// — in dev it is served by the Vite dev server
 * (http://localhost:5173/) and in production it is loaded from the app bundle
 * (file://…/out/renderer/index.html) — so every call from the browser's own
 * toolbar was rejected: "Unauthorized IPC call to omnibox:suggest from
 * http://localhost:5173/". The address bar, tab strip, back/forward — the
 * entire UI — was locked out of its own browser.
 *
 * Trusted senders (decided by `ipcGuardDecision`):
 *   1. The chrome-UI webContents of a registered browser window. ipc.ts
 *      establishes this by IDENTITY — the sender must BE `entry.win.webContents`
 *      — never by URL. A remote https page, a file:// page opened in a tab, or
 *      any other webContents can never match, and the check works identically
 *      in dev (Vite URL) and production (file://) without ever whitelisting
 *      those schemes for arbitrary senders.
 *   2. aether:// pages (new-tab, search, settings, history, bookmarks …).
 *      Those URLs are only ever served by our own protocol handler, so the
 *      prefix check is sufficient for them.
 *
 * Everything else — https pages, plain file:// pages, unknown schemes — is
 * rejected, exactly as before.
 */

/**
 * Pure decision used by the IPC guard in ipc.ts. Kept free of electron
 * imports so the unit tests can exercise it without stubbing the runtime.
 *
 * @param senderUrl                  result of `sender.getURL()` (may be null/undefined/empty)
 * @param isWindowChromeWebContents  true only when the sender IS the registered
 *                                   chrome-UI webContents of a browser window
 */
export function ipcGuardDecision(
  senderUrl: string | null | undefined,
  isWindowChromeWebContents: boolean
): boolean {
  if (isWindowChromeWebContents) return true
  return isAetherInternalSender(senderUrl)
}

/**
 * Stricter rule for the internal-page-only handlers (`internal:search`,
 * `internal:open`, `internal:startup`, `internal:ask`) — those exist purely to
 * serve aether:// pages, so even the chrome UI does not get to call them.
 */
export function isAetherInternalSender(senderUrl: string | null | undefined): boolean {
  return typeof senderUrl === 'string' && senderUrl.startsWith('aether://')
}
