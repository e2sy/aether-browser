/**
 * Multi-profiles registry (v2.4.0 build 18) — main-process side.
 *
 * initProfiles() is called from preboot BEFORE the single-instance lock, so
 * the registry path is pinned to the ORIGINAL userData dir (before any
 * profile setPath / cache-recovery relocation). Every other module can then
 * ask this file who is active and what the available profiles are.
 *
 * Storage layout:
 *   <original userData>/                 ← the DEFAULT profile's data dir
 *   <original userData>/profiles.json    ← the registry (fixed path)
 *   <original userData>/profiles/<id>/   ← each extra profile's data dir
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_PROFILE_ID,
  MAX_PROFILES,
  canDeleteProfile,
  normalizeProfileColor,
  normalizeRegistry,
  sanitizeProfileName,
  touchProfile,
  validateProfileId,
  type Profile,
  type ProfileRegistry
} from '../shared/profiles'

let registryPath = ''
let profilesRoot = ''
let activeId = DEFAULT_PROFILE_ID
let cache: ProfileRegistry = normalizeRegistry(null)

/** Called once from preboot — before the lock, before anything reads userData. */
export function initProfiles(originalUserData: string, profileId: string): void {
  registryPath = path.join(originalUserData, 'profiles.json')
  profilesRoot = path.join(originalUserData, 'profiles')
  activeId = profileId
  cache = readRegistry()
  // make sure the active profile (when non-default) is marked used
  if (profileId !== DEFAULT_PROFILE_ID) {
    const before = JSON.stringify(cache)
    cache = touchProfile(cache, profileId)
    if (JSON.stringify(cache) !== before) writeRegistry(cache)
  }
}

function readRegistry(): ProfileRegistry {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
    return normalizeRegistry(raw)
  } catch {
    return normalizeRegistry(null)
  }
}

function writeRegistry(reg: ProfileRegistry): void {
  try {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true })
    fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2))
    cache = reg
  } catch (err) {
    console.error('[profiles] registry write failed', err)
  }
}

export function listProfiles(): Profile[] {
  return cache.profiles
}

export function activeProfileId(): string {
  return activeId
}

export function activeProfile(): Profile | undefined {
  return cache.profiles.find((p) => p.id === activeId)
}

/** '' for the default profile — windows.ts uses this as a title suffix. */
export function activeProfileName(): string {
  return activeId === DEFAULT_PROFILE_ID ? '' : activeProfile()?.name ?? ''
}

export function createProfile(name: unknown, color: unknown): { ok: boolean; error?: string } {
  if (cache.profiles.length >= MAX_PROFILES) return { ok: false, error: `Up to ${MAX_PROFILES} profiles are supported` }
  const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 46656)
    .toString(36)
    .padStart(3, '0')}`
  const now = Date.now()
  const next: ProfileRegistry = {
    profiles: [
      ...cache.profiles,
      { id, name: sanitizeProfileName(name, `Profile ${cache.profiles.length + 1}`), color: normalizeProfileColor(color), createdAt: now, lastUsedAt: 0 }
    ]
  }
  writeRegistry(next)
  try {
    fs.mkdirSync(path.join(profilesRoot, id), { recursive: true })
  } catch {
    /* created lazily on first launch — not fatal */
  }
  return { ok: true }
}

export function renameProfile(id: unknown, name: unknown): { ok: boolean; error?: string } {
  if (!validateProfileId(id) || !cache.profiles.some((p) => p.id === id)) return { ok: false, error: 'Unknown profile' }
  const clean = sanitizeProfileName(name)
  writeRegistry({ profiles: cache.profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) })
  return { ok: true }
}

export function deleteProfile(id: unknown): { ok: boolean; error?: string } {
  const verdict = canDeleteProfile(cache.profiles, String(id ?? ''), activeId)
  if (!verdict.ok) return verdict
  writeRegistry({ profiles: cache.profiles.filter((p) => p.id !== id) })
  // best-effort data wipe — the profile's whole userData subtree
  try {
    fs.rmSync(path.join(profilesRoot, String(id)), { recursive: true, force: true })
  } catch (err) {
    console.warn('[profiles] data dir cleanup failed (registry entry removed anyway)', err)
  }
  return { ok: true }
}

/** argv for the relaunch that switches profiles — strips any previous
 *  --aether-profile / --aether-app so the new instance boots clean. */
export function switchProfileArgs(id: string): string[] {
  return [
    ...process.argv
      .slice(1)
      .filter((a) => !/^--aether-profile(=|$)/.test(a) && !/^--aether-app(=|$)/.test(a)),
    `--aether-profile=${id}`
  ]
}