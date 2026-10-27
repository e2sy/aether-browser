/**
 * Aether Containers — main-process side (v2.7.0 build 21).
 *
 * Each container owns a PERSISTENT Electron session partition
 * (persist:cnt-<id>) → isolated cookie jar, localStorage, cache, service
 * workers. Every new container session gets the full browser hardening:
 * shields pipeline, privacy fortress (scrubber/HTTPS-only/referrer), the
 * farble preload, the stripped UA and the effective proxy (global or its
 * own override).
 *
 * Registry lives in containers.json; pure validation comes from
 * shared/containers.ts.
 */
import { session } from 'electron'
import {
  containerById,
  newContainerId,
  normalizeColor,
  normalizeTimezone,
  partitionFor,
  sanitizeContainerName,
  sanitizeRegistry,
  seedContainers,
  uniqueName,
  type ContainerDef,
  type ContainerRegistry
} from '../shared/containers'

/** Re-exported for tabs.ts (single import site). */
export { isValidContainerId } from '../shared/containers'
import { registerShieldsSession } from './adblock'
import { registerFarbleOnSession } from './farble'
import { registerGestureOnSession } from './gestures'
import { installPrivacy } from './privacy'
import { JsonStore, mergedSettings } from './store'
import { applySessionProxy, effectiveProxyForContainer } from './netmask'

export type { ContainerDef }

const store = new JsonStore<ContainerRegistry>('containers.json', { containers: [] })

/** container ids whose partition session is already fully wired */
const wired = new Set<string>()

/** First boot: seed the built-in identities. */
export function initContainers(): void {
  const clean = sanitizeRegistry(store.data)
  if (!clean.containers.length) {
    clean.containers = seedContainers()
    console.log('[containers] seeded', clean.containers.length, 'built-in containers')
  }
  store.data = clean
  store.save()
}

export function listContainers(): ContainerDef[] {
  return sanitizeRegistry(store.data).containers
}

export function containerOfWebContents(wc: Electron.WebContents): ContainerDef | null {
  // Electron exposes no "which partition am I in" API — compare session
  // objects instead: each container has exactly one Session instance.
  let target: Electron.Session | null = null
  try {
    target = wc.session || null
  } catch {
    return null
  }
  if (!target) return null
  for (const c of listContainers()) {
    try {
      if (session.fromPartition(partitionFor(c.id)) === target) return c
    } catch {
      /* not this one */
    }
  }
  return null
}

/** The timezone resolver handed to farble.ts at boot. */
export function containerTimezoneFor(wc: Electron.WebContents): string {
  return containerOfWebContents(wc)?.timezone || ''
}

function stripSessionUA(ses: Electron.Session): void {
  try {
    ses.setUserAgent(ses.getUserAgent().replace(/\s+Electron\/\S+/, ''))
  } catch {
    /* UA stripping is cosmetic */
  }
}

/** Create-or-fetch the container's session and make sure it is hardened. */
export function ensureContainerSession(id: string): Electron.Session {
  const c = containerById(listContainers(), id)
  if (!c) throw new Error(`unknown container: ${String(id).slice(0, 40)}`)
  const ses = session.fromPartition(partitionFor(c.id), { cache: true })
  if (!wired.has(c.id)) {
    wired.add(c.id)
    stripSessionUA(ses)
    registerShieldsSession(ses)
    registerFarbleOnSession(ses)
    registerGestureOnSession(ses)
    installPrivacy(
      () => ({
        paramScrubber: mergedSettings().paramScrubber !== false,
        deAmp: mergedSettings().deAmp !== false,
        httpsOnly: mergedSettings().httpsOnly === true,
        httpsExemptHosts: Array.isArray(mergedSettings().httpsExemptHosts) ? mergedSettings().httpsExemptHosts : [],
        referrerTight: mergedSettings().referrerTight !== false
      }),
      ses
    )
    void applySessionProxy(ses, effectiveProxyForContainer(c))
    console.log('[containers] session wired:', c.name)
  }
  return ses
}

export function containerSession(id: string): Electron.Session | null {
  if (!containerById(listContainers(), id)) return null
  try {
    return session.fromPartition(partitionFor(id), { cache: true })
  } catch {
    return null
  }
}

export function createContainer(name: string, color: string): ContainerDef | null {
  const clean = sanitizeContainerName(name)
  if (!clean) return null
  const list = listContainers()
  const c: ContainerDef = {
    id: newContainerId(),
    name: uniqueName(clean, list),
    color: normalizeColor(color),
    proxyUrl: '',
    timezone: '',
    builtin: false,
    ts: Date.now()
  }
  store.data = { containers: [...list, c] }
  store.save()
  console.log('[containers] created:', c.name, c.id)
  return c
}

export function updateContainer(id: string, patch: { name?: string; color?: string; proxyUrl?: string; timezone?: string }): ContainerDef | null {
  const list = listContainers()
  const idx = list.findIndex((c) => c.id === id)
  if (idx < 0) return null
  const cur = list[idx]
  const next: ContainerDef = { ...cur }
  if (patch.name !== undefined) {
    const clean = sanitizeContainerName(patch.name)
    if (clean) next.name = clean === cur.name ? clean : uniqueName(clean, list.filter((x) => x.id !== id))
  }
  if (patch.color !== undefined) next.color = normalizeColor(patch.color)
  if (patch.proxyUrl !== undefined) next.proxyUrl = typeof patch.proxyUrl === 'string' ? patch.proxyUrl.slice(0, 300) : ''
  if (patch.timezone !== undefined) next.timezone = normalizeTimezone(patch.timezone)
  const out = [...list]
  out[idx] = next
  store.data = { containers: out }
  store.save()
  // proxy/timezone changes must reach the (possibly already-wired) session
  try {
    const ses = session.fromPartition(partitionFor(id), { cache: true })
    void applySessionProxy(ses, effectiveProxyForContainer(next))
  } catch {
    /* session not created yet — will be wired on first use */
  }
  return next
}
/** Delete a container: tabs move to the default session (caller handles), the
 *  partition's cookies/storage/cache are wiped. */
export async function deleteContainer(id: string): Promise<boolean> {
  const list = listContainers()
  if (!containerById(list, id)) return false
  store.data = { containers: list.filter((c) => c.id !== id) }
  store.save()
  wired.delete(id)
  try {
    const ses = session.fromPartition(partitionFor(id), { cache: true })
    await ses.clearStorageData()
    await ses.clearCache()
  } catch {
    /* wipe is best-effort */
  }
  console.log('[containers] deleted:', id)
  return true
}

/** Clear one container's cookies + site data (keep the container itself). */
export async function clearContainerData(id: string): Promise<void> {
  const ses = containerSession(id)
  if (!ses) return
  try {
    await ses.clearStorageData()
    await ses.clearCache()
  } catch {
    /* best-effort */
  }
}

/** After a proxy settings change, re-apply to every wired container. */
export function applyProxyToAllContainers(): void {
  for (const c of listContainers()) {
    if (!wired.has(c.id)) continue
    try {
      const ses = session.fromPartition(partitionFor(c.id), { cache: true })
      void applySessionProxy(ses, effectiveProxyForContainer(c))
    } catch {
      /* skip */
    }
  }
}
