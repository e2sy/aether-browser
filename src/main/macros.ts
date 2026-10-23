/**
 * Agent macros — a recorded run becomes a replayable script (no model needed).
 * Steps store either the original element ref (unstable across sessions) or a
 * `__locator` CSS path captured at record time, which replay prefers.
 */
import { randomUUID } from 'node:crypto'
import { JsonStore } from './store'
import type { Macro, MacroStep } from '../shared/types'

const MAX_STEPS = 40

const store = new JsonStore<Macro[]>('macros.json', [])

export function listMacros(): Macro[] {
  return [...store.data].sort((a, b) => b.createdAt - a.createdAt)
}

export function getMacro(id: string): Macro | undefined {
  return store.data.find((m) => m.id === id)
}

/** Save recorded steps. Returns the stored macro or an error string. */
export function saveMacro(name: string, task: string, steps: MacroStep[]): { macro?: Macro; error?: string } {
  const cleanName = String(name || '').trim().slice(0, 60)
  if (!cleanName) return { error: 'Macro needs a name' }
  if (!Array.isArray(steps) || steps.length === 0) return { error: 'No recorded steps to save' }
  if (steps.length > MAX_STEPS) return { error: `Too many steps (${steps.length}, max ${MAX_STEPS})` }

  const allowedTools = new Set(['navigate', 'click', 'type', 'press_key', 'scroll', 'go_back'])
  const clean: MacroStep[] = []
  for (const st of steps) {
    if (!st || !allowedTools.has(String(st.tool))) continue
    let args: Record<string, unknown> = {}
    try {
      args = typeof st.args === 'object' && st.args !== null ? JSON.parse(JSON.stringify(st.args)) : {}
    } catch {
      continue
    }
    if (JSON.stringify(args).length > 4096) continue
    clean.push({ tool: String(st.tool), args })
  }
  if (!clean.length) return { error: 'No replayable steps (only navigate/click/type/press_key/scroll/go_back are recorded)' }

  const macro: Macro = {
    id: randomUUID().replace(/-/g, '').slice(0, 12),
    name: cleanName,
    task: String(task || '').slice(0, 500),
    steps: clean,
    createdAt: Date.now(),
    runs: 0
  }
  store.data = [macro, ...store.data].slice(0, 50)
  store.save()
  return { macro }
}

export function deleteMacro(id: string): void {
  store.data = store.data.filter((m) => m.id !== id)
  store.save()
}

/** Edit a saved macro: rename and/or modify steps (macro editor). */
export function updateMacro(
  id: string,
  patch: { name?: string; task?: string; steps?: MacroStep[] }
): { macro?: Macro; error?: string } {
  const m = getMacro(String(id || ''))
  if (!m) return { error: 'Macro not found' }

  if (patch.name !== undefined) {
    const cleanName = String(patch.name || '').trim().slice(0, 60)
    if (!cleanName) return { error: 'Macro needs a name' }
    m.name = cleanName
  }
  if (patch.task !== undefined) m.task = String(patch.task || '').slice(0, 500)

  if (patch.steps !== undefined) {
    const steps = Array.isArray(patch.steps) ? patch.steps : []
    if (steps.length === 0) return { error: 'Macro needs at least one step' }
    if (steps.length > MAX_STEPS) return { error: `Too many steps (${steps.length}, max ${MAX_STEPS})` }
    const allowedTools = new Set(['navigate', 'click', 'type', 'press_key', 'scroll', 'go_back'])
    const clean: MacroStep[] = []
    for (const st of steps) {
      if (!st || !allowedTools.has(String(st.tool))) continue
      let args: Record<string, unknown> = {}
      try {
        args = typeof st.args === 'object' && st.args !== null ? JSON.parse(JSON.stringify(st.args)) : {}
      } catch {
        continue
      }
      if (JSON.stringify(args).length > 4096) continue
      clean.push({ tool: String(st.tool), args })
    }
    if (!clean.length) {
      return { error: 'No replayable steps (only navigate/click/type/press_key/scroll/go_back are allowed)' }
    }
    m.steps = clean
  }

  store.save()
  return { macro: m }
}

export function markRun(id: string): void {
  const m = getMacro(id)
  if (m) {
    m.runs += 1
    store.save()
  }
}
