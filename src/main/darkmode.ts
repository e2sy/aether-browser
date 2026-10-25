/**
 * Force-Dark v2 (Master Plan Phase 2, item #52) — per-site force-dark with a
 * night scheduler, on top of Chromium's auto-darkening when available.
 *
 * Chromium's WebContentsForceDark feature flag is global (must be set before
 * app ready), so per-site control is done with a CSS inversion injected on
 * navigation for the hosts the user listed. Scheduler modes:
 *   'off'    — never
 *   'always' — every day, for the listed hosts
 *   'night'  — only between 20:00 and 07:00 local time
 *
 * Pure policy is unit-tested (test-v183.mjs).
 */
export type DarkMode = 'off' | 'always' | 'night'
/** Pure: are we inside the night window (20:00–07:00 local)? */
export function inNightHours(d: Date = new Date()): boolean {
  const h = d.getHours()
  return h >= 20 || h < 7
}

export interface DarkPolicy {
  mode: DarkMode
  /** hosts with force-dark enabled (exact host, www-stripped compare) */
  hosts: string[]
}

/** Pure: normalize a host list (lowercase, strip www., dedupe, cap 200). */
export function cleanHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const r of raw) {
    const h = String(r ?? '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '')
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && !out.includes(h)) out.push(h)
  }
  return out.slice(0, 200)
}

/** Pure: should THIS host be force-darkened right now? */
export function shouldForceDark(host: string, policy: DarkPolicy, now: Date = new Date()): boolean {
  if (!host) return false
  if (policy.mode === 'off') return false
  if (policy.mode === 'night' && !inNightHours(now)) return false
  const h = String(host).toLowerCase().replace(/^www\./, '')
  return policy.hosts.includes(h)
}

/** CSS injected for force-dark hosts (invert + hue-rotate keeps photos sane). */
export const DARK_CSS = `
html { filter: invert(1) hue-rotate(180deg) contrast(0.92); background: #fff; }
img, video, picture, canvas, svg, iframe, [style*="background-image"] {
  filter: invert(1) hue-rotate(180deg);
}
`

/**
 * Inject (or clear) the dark CSS on every navigation of every tab webContents.
 * Registered once at boot via web-contents-created (main/index.ts).
 */
export function wireForceDark(e: Electron.WebContents, policyOf: () => DarkPolicy): void {
  e.on('did-navigate', (_event, url) => {
    try {
      const host = (() => {
        try {
          return new URL(url).hostname
        } catch {
          return ''
        }
      })()
      if (shouldForceDark(host, policyOf())) {
        void e.insertCSS(DARK_CSS, { cssOrigin: 'user' }).catch(() => undefined)
      }
    } catch {
      /* cosmetic feature — never break navigation */
    }
  })
  e.on('did-navigate-in-page', (_event, url) => {
    try {
      const host = (() => {
        try {
          return new URL(url).hostname
        } catch {
          return ''
        }
      })()
      if (shouldForceDark(host, policyOf())) {
        void e.insertCSS(DARK_CSS, { cssOrigin: 'user' }).catch(() => undefined)
      }
    } catch {
      /* cosmetic */
    }
  })
}
