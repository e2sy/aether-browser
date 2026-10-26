/**
 * Fingerprint farbling (v2.7.0 build 21) — pure config + seed math.
 *
 * Brave-style farbling: every site gets DIFFERENT but STABLE-WITHIN-SESSION
 * readings for the APIs most abused for fingerprinting (canvas, WebGL GPU
 * strings, audio, hardware). The seed is derived from the site's host plus a
 * random per-boot salt, so:
 *   - same site, same boot  → identical readings (fewer breakages)
 *   - different sites       → different readings (no cross-site linkability)
 *   - next boot             → different again (no long-term stability)
 *
 * The patching itself lives in preload/farble.js (sandbox-safe plain JS, no
 * imports); this module holds the shared shape, seed derivation and value
 * pools so main-process code and the test suite agree on the contract.
 */

export type FarbleMode = 'off' | 'standard'
export const FARBLE_MODES: readonly FarbleMode[] = Object.freeze(['off', 'standard'])

export interface FarbleConfig {
  mode: FarbleMode
  /** '' = report the real timezone; else an IANA zone (proxied containers) */
  timezone: string
  /** per-boot random salt — never persisted */
  salt: string
}

export function normalizeFarbleMode(raw: unknown): FarbleMode {
  return FARBLE_MODES.includes(raw as FarbleMode) ? (raw as FarbleMode) : 'off'
}

/** FNV-1a 32-bit — the same tiny hash the preload re-implements. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic per-(host, salt) seed. Host is normalized lowercase. */
export function seedFor(host: string, salt: string): number {
  return fnv1a(String(host || '').toLowerCase().trim() + '|' + String(salt || ''))
}

/** Pick from a pool by seed (uniform-ish, deterministic). */
export function pickFrom<T>(pool: readonly T[], seed: number): T {
  return pool[Math.abs(seed) % pool.length]
}

export const HW_CONCURRENCY_POOL: readonly number[] = Object.freeze([2, 4, 6, 8, 12, 16])
export const DEVICE_MEMORY_POOL: readonly number[] = Object.freeze([2, 4, 8])

/** Believable (unmaskedVendor, unmaskedRenderer) pairs — indexed by seed. */
export const GPU_POOL: readonly { vendor: string; renderer: string }[] = Object.freeze([
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' }
])

export function gpuPairFor(seed: number): { vendor: string; renderer: string } {
  return pickFrom(GPU_POOL, seed)
}

/**
 * Deterministic byte noise in [-1, 1] scaled — used by canvas/audio farbling.
 * Two rounds of FNV keep consecutive indexes decorrelated.
 */
export function noiseAt(seed: number, index: number): number {
  let h = fnv1a(String(seed >>> 0) + ':' + String(index | 0))
  h = fnv1a(String(h) + 'n')
  return ((h % 3) - 1) // -1 | 0 | 1
}

/** How many values to touch per read (small — keeps rendering usable). */
export const NOISE_STRIDE = 253 // prime → spreads across the buffer

export function farbleActive(mode: FarbleMode): boolean {
  return mode === 'standard'
}
