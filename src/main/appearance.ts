/**
 * Customization Studio engine (v1.4.0) — pure, deterministic, fully tested.
 *
 * Owns the appearance model: validation/normalization of user customization,
 * the dark + light palettes, and the CSS-variable block that themes every
 * aether:// page and (via the chrome UI) the browser shell itself.
 *
 * No electron imports here — this module must stay testable in a sandbox.
 */

export interface AppearanceSettings {
  /** dark (default) / light / follow the OS */
  theme: 'dark' | 'light' | 'system'
  /** #rrggbb accent used for highlights, buttons, focus rings */
  accent: string
  /** UI zoom for internal pages + chrome (0.85 – 1.25) */
  fontScale: number
  /** new-tab background preset */
  newtabBg: 'aurora' | 'midnight' | 'slate' | 'light' | 'solid'
  /** show the clock + greeting on the new tab */
  newtabClock: boolean
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'dark',
  accent: '#7c8cff',
  fontScale: 1,
  newtabBg: 'aurora',
  newtabClock: true
}

/** Curated accent swatches shown in the Customization section. */
export const ACCENT_PRESETS: string[] = [
  '#7c8cff', // aether violet (default)
  '#4f9cf9', // blue
  '#3fb27f', // green
  '#e0a63a', // amber
  '#e5636f', // red
  '#b06ce6', // purple
  '#2fb8c6', // teal
  '#f07ab8' // pink
]

const THEMES = ['dark', 'light', 'system']
const NTBGS = ['aurora', 'midnight', 'slate', 'light', 'solid']
const SCALE_MIN = 0.85
const SCALE_MAX = 1.25

export function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)
}

/* -------------------------------- palettes -------------------------------- */

export interface Palette {
  bg: string
  ntbg: string
  fg: string
  card: string
  card2: string
  border: string
  borderHi: string
  muted: string
  muted2: string
  faint: string
  danger: string
  dangerBg: string
  dangerBorder: string
  ok: string
}

export const DARK_PALETTE: Palette = {
  bg: '#16171b',
  ntbg: '', // set per newtabBg preset in appearanceCss
  fg: '#e8eaf0',
  card: '#1e2026',
  card2: '#1a1c21',
  border: '#2e313a',
  borderHi: '#3d4150',
  muted: '#9aa0ae',
  muted2: '#7d828f',
  faint: '#565b66',
  danger: '#ff8a8a',
  dangerBg: '#2a1c1c',
  dangerBorder: '#3a2a2a',
  ok: '#4ade80'
}

export const LIGHT_PALETTE: Palette = {
  bg: '#f5f6fa',
  ntbg: '',
  fg: '#1c1f28',
  card: '#ffffff',
  card2: '#f1f3f9',
  border: '#d9dde8',
  borderHi: '#b9c0d4',
  muted: '#5b6272',
  muted2: '#6d7484',
  faint: '#8a90a0',
  danger: '#c73f4a',
  dangerBg: '#fdeef0',
  dangerBorder: '#f2cdd2',
  ok: '#1e7f4f'
}

/** Mix a hex color toward black (amount 0..1) — used to derive accent variants. */
export function shadeHex(hex: string, amount: number): string {
  if (!isHexColor(hex)) return hex
  const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16)
  const mix = (v: number): string => {
    const out = Math.max(0, Math.min(255, Math.round(v * (1 - amount))))
    return out.toString(16).padStart(2, '0')
  }
  return '#' + mix(n(1)) + mix(n(3)) + mix(n(5))
}

/** Hex #rrggbb -> rgba(...) string with the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  if (!isHexColor(hex)) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/* ------------------------------ normalization ------------------------------ */

/**
 * Validate an arbitrary patch (from disk or IPC) against the model. Per-field:
 * invalid values fall back to the CURRENT value when given, else the default.
 * Never throws — a corrupted settings.json appearance blob must not kill boot.
 */
export function normalizeAppearance(
  patch: unknown,
  current: AppearanceSettings = DEFAULT_APPEARANCE
): AppearanceSettings {
  const base = current || DEFAULT_APPEARANCE
  if (!patch || typeof patch !== 'object') return { ...base }
  const p = patch as Record<string, unknown>
  const out: AppearanceSettings = { ...base }

  if (typeof p.theme === 'string' && THEMES.includes(p.theme)) {
    out.theme = p.theme as AppearanceSettings['theme']
  }
  if (isHexColor(p.accent)) {
    out.accent = p.accent.toLowerCase()
  }
  if (typeof p.fontScale === 'number' && Number.isFinite(p.fontScale)) {
    out.fontScale = Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, p.fontScale)) * 100) / 100
  }
  if (typeof p.newtabBg === 'string' && NTBGS.includes(p.newtabBg)) {
    out.newtabBg = p.newtabBg as AppearanceSettings['newtabBg']
  }
  if (typeof p.newtabClock === 'boolean') {
    out.newtabClock = p.newtabClock
  }
  return out
}

/* ------------------------------ CSS emission ------------------------------- */

const NEWTAB_BG: Record<AppearanceSettings['newtabBg'], { dark: string; light: string }> = {
  aurora: {
    dark: 'radial-gradient(1100px 520px at 18% -10%, rgba(124,140,255,.16), transparent 60%), radial-gradient(900px 460px at 88% 0%, rgba(47,184,198,.10), transparent 55%), #16171b',
    light: 'radial-gradient(1100px 520px at 18% -10%, rgba(124,140,255,.20), transparent 60%), radial-gradient(900px 460px at 88% 0%, rgba(47,184,198,.12), transparent 55%), #f5f6fa'
  },
  midnight: {
    dark: 'linear-gradient(180deg, #0b0d13 0%, #16171b 70%)',
    light: 'linear-gradient(180deg, #eef1f8 0%, #f5f6fa 70%)'
  },
  slate: { dark: '#1e2026', light: '#eceef4' },
  light: { dark: '#f5f6fa', light: '#f5f6fa' },
  solid: { dark: '#16171b', light: '#f5f6fa' }
}

/**
 * The `:root` variable block consumed by every internal page's CSS.
 * `systemDark` resolves `theme: 'system'` (main passes nativeTheme).
 */
export function appearanceCss(a: AppearanceSettings, systemDark = true): string {
  const dark = a.theme === 'system' ? systemDark : a.theme === 'dark'
  const p = dark ? DARK_PALETTE : LIGHT_PALETTE
  const ntbg = NEWTAB_BG[a.newtabBg][dark ? 'dark' : 'light']
  const accentStrong = shadeHex(a.accent, dark ? 0.14 : 0.22)
  return `
:root {
  --ax-bg: ${p.bg};
  --ax-fg: ${p.fg};
  --ax-card: ${p.card};
  --ax-card2: ${p.card2};
  --ax-border: ${p.border};
  --ax-border-hi: ${p.borderHi};
  --ax-muted: ${p.muted};
  --ax-muted2: ${p.muted2};
  --ax-faint: ${p.faint};
  --ax-danger: ${p.danger};
  --ax-danger-bg: ${p.dangerBg};
  --ax-danger-border: ${p.dangerBorder};
  --ax-ok: ${p.ok};
  --ax-ok-soft: ${hexToRgba(p.ok, dark ? 0.12 : 0.16)};
  --ax-danger-soft: ${hexToRgba(p.danger, dark ? 0.12 : 0.14)};
  --ax-muted-soft: ${hexToRgba(p.muted, dark ? 0.1 : 0.12)};
  --ax-accent: ${a.accent.toLowerCase()};
  --ax-accent2: ${accentStrong};
  --ax-accent-tint: ${shadeHex(a.accent, dark ? 0.45 : 0.35)};
  --ax-accent-soft: ${hexToRgba(a.accent, dark ? 0.1 : 0.14)};
  --ax-ntbg: ${ntbg};
  --ax-dark: ${dark ? '1' : '0'};
}
body { background: var(--ax-bg); color: var(--ax-fg); zoom: ${a.fontScale}; }
a { color: inherit; }
`.trim()
}
