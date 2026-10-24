/**
 * Agent macros — a recorded run becomes a replayable script (no model needed).
 * Steps store either the original element ref (unstable across sessions) or a
 * `__locator` CSS path captured at record time, which replay prefers.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { dialog, BrowserWindow } from 'electron'
import { JsonStore } from './store'
import type { Macro, MacroFile, MacroStep } from '../shared/types'

const MAX_STEPS = 40
const ALLOWED_TOOLS = new Set(['navigate', 'click', 'type', 'press_key', 'scroll', 'go_back'])

const store = new JsonStore<Macro[]>('macros.json', [])

/** Shared step sanitizer — used by save, update and import. */
function sanitizeSteps(steps: unknown): { steps: MacroStep[]; skipped: number } {
  const list = Array.isArray(steps) ? steps : []
  const clean: MacroStep[] = []
  let skipped = 0
  for (const st of list) {
    if (!st || !ALLOWED_TOOLS.has(String((st as MacroStep).tool))) {
      skipped++
      continue
    }
    let args: Record<string, unknown> = {}
    try {
      const raw = (st as MacroStep).args
      args = typeof raw === 'object' && raw !== null ? JSON.parse(JSON.stringify(raw)) : {}
    } catch {
      skipped++
      continue
    }
    if (JSON.stringify(args).length > 4096) {
      skipped++
      continue
    }
    clean.push({ tool: String((st as MacroStep).tool), args })
  }
  return { steps: clean, skipped }
}

/**
 * Validate an untrusted macro file (macros:import). Returns a clean Macro
 * payload or an error string — never throws on bad input.
 */
export function validateMacroImport(raw: unknown): { name: string; task: string; steps: MacroStep[]; warning?: string } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Not a macro file (expected a JSON object)' }
  const obj = raw as Partial<MacroFile>
  if (obj.aetherMacro !== 1) return { error: 'Not an Aether macro file (missing aetherMacro marker)' }
  const cleanName = String(obj.name || '').trim().slice(0, 60)
  if (!cleanName) return { error: 'Macro file has no name' }
  const { steps, skipped } = sanitizeSteps(obj.steps)
  if (!steps.length) return { error: 'No replayable steps (only navigate/click/type/press_key/scroll/go_back can be imported)' }
  return {
    name: cleanName,
    task: String(obj.task || '').slice(0, 500),
    steps,
    ...(skipped > 0 ? { warning: `${skipped} step(s) were not replayable and were dropped` } : {})
  }
}

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

  const { steps: clean } = sanitizeSteps(steps)
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
    const { steps: clean } = sanitizeSteps(steps)
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

// ---------- import / export (share macros as .json files) ----------

function macroFileName(name: string): string {
  return name.replace(/[^\w .()-]+/g, '_').slice(0, 60) + '.macro.json'
}

/** Write a macro to a user-chosen .json file. Returns the path or null (cancel). */
export async function exportMacro(id: string, parent?: BrowserWindow): Promise<string | null> {
  const m = getMacro(String(id || ''))
  if (!m) throw new Error('Macro not found')
  const res = await dialog.showSaveDialog(parent ?? (undefined as unknown as BrowserWindow), {
    title: 'Export macro',
    defaultPath: macroFileName(m.name),
    filters: [{ name: 'Aether macro', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePath) return null
  const payload: MacroFile = {
    aetherMacro: 1,
    name: m.name,
    task: m.task,
    steps: m.steps,
    exportedAt: Date.now()
  }
  fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2))
  return res.filePath
}

/** Read + validate a macro from a user-chosen file, then store it. */
export async function importMacro(parent?: BrowserWindow): Promise<{ macro?: Macro; warning?: string }> {
  const res = await dialog.showOpenDialog(parent ?? (undefined as unknown as BrowserWindow), {
    title: 'Import macro',
    filters: [{ name: 'Aether macro', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return {}
  const file = res.filePaths[0]
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    throw new Error('Could not read the file as JSON: ' + (err instanceof Error ? err.message : String(err)))
  }
  const parsed = validateMacroImport(raw)
  if ('error' in parsed) throw new Error(parsed.error)

  // de-duplicate the name against existing macros
  const existing = new Set(listMacros().map((m) => m.name.toLowerCase()))
  let name = parsed.name
  for (let i = 2; existing.has(name.toLowerCase()); i++) name = `${parsed.name} (${i})`.slice(0, 60)

  const macro: Macro = {
    id: randomUUID().replace(/-/g, '').slice(0, 12),
    name,
    task: parsed.task,
    steps: parsed.steps,
    createdAt: Date.now(),
    runs: 0
  }
  store.data = [macro, ...store.data].slice(0, 50)
  store.save()
  return { macro, warning: parsed.warning }
}
