/**
 * Pure formatting / naming helpers shared by main and renderer.
 * No Electron, no Node builtins — safe to bundle anywhere (build 19 tests).
 */

/** `aether-2026-10-26-142533.png` style screenshot names (second resolution). */
export function shotFilename(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `aether-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`
}

/** Firefox-style reading-time estimate: 265 wpm, min 1. */
export function readingTimeMin(words: number): number {
  const w = Number(words) || 0
  if (w <= 0) return 1
  return Math.max(1, Math.round(w / 265))
}

/** 1234 → "1.2 KB", 0 → "0 B". Input is BYTES (caller converts KB when needed). */
export function fmtBytes(bytes: number): string {
  const b = Number(bytes) || 0
  const abs = Math.abs(b)
  if (abs < 1024) return `${Math.round(b)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = b / 1024
  let i = 0
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`
}

/** CPU percent for display: "12%", 0 → "0%". */
export function fmtPct(pct: number): string {
  const p = Number(pct) || 0
  if (p < 0.05) return '0%'
  if (p < 10) return `${Math.round(p * 10) / 10}%`
  return `${Math.round(p)}%`
}

/** Long labels for the task-manager table (no HTML — textContent only). */
export function truncate(s: string, max = 72): string {
  const str = String(s || '')
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}
