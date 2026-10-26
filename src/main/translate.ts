/**
 * Full-page translate runtime (v2.6.0 build 20).
 *
 * Flow (mirrors reader view):
 *   1. menu / context-menu click → captureTranslatePage(wc) extracts the
 *      readable PLAIN-TEXT paragraphs (reader.ts) into the store, then the
 *      caller navigates the same webContents to aether://translate
 *   2. the translate page calls window.aether.translate.get() → the stored
 *      doc for that exact sender (original paragraphs, none translated yet)
 *   3. the page calls translate.run(langCode) → main translates the STORED
 *      paragraphs chunk-by-chunk with the local Ollama model, broadcasting
 *      'translate:update' after every chunk so the page fills in live
 *   4. changing the language re-runs from the stored originals (no recapture)
 *
 * The translation NEVER leaves the machine unless the user opted into the
 * cloud fallback (brain.ts) — the page says so.
 */
import type { WebContents } from 'electron'
import {
  buildTranslatePrompt,
  isLangCode,
  langName,
  parseTranslatedChunk,
  progressPct,
  TRANSLATE_SYSTEM,
  makeTranslateChunks
} from '../shared/translate'
import { pickTranslateModelFrom } from '../shared/transmodel'
import { chatStream, listModels } from './ollama'
import { extractParagraphs } from './reader'

export interface TranslateDoc {
  url: string
  title: string
  paras: string[]
  /** translation output, aligned 1:1 with paras ('' = not translated yet) */
  out: string[]
  langCode: string
  running: boolean
  error: string | null
  model: string | null
}

const store = new Map<number, TranslateDoc>()

export function getTranslateDoc(wcId: number): TranslateDoc | null {
  const d = store.get(wcId)
  return d ? { ...d, out: [...d.out] } : null
}

export function forgetTranslateDoc(wcId: number): void {
  store.delete(wcId)
}

/** Abort handles per wc id so a new run can stop the old one. */
const runs = new Map<number, AbortController>()

function sendUpdate(wc: WebContents, doc: TranslateDoc): void {
  if (!wc.isDestroyed()) {
    wc.send('translate:update', {
      langCode: doc.langCode,
      running: doc.running,
      error: doc.error,
      model: doc.model,
      progress: progressPct(doc.out.filter(Boolean).length, doc.paras.length),
      out: doc.out
    })
  }
}

/** Step 1 — capture the page the wc is currently showing. */
export async function captureTranslatePage(wc: WebContents): Promise<TranslateDoc> {
  const { title, paras } = await extractParagraphs(wc)
  const doc: TranslateDoc = {
    url: wc.getURL(),
    title,
    paras,
    out: paras.map(() => ''),
    langCode: '',
    running: false,
    error: null,
    model: null
  }
  store.set(wc.id, doc)
  return doc
}

/** Model preference lives in shared/transmodel.ts (pure, unit-tested). */

async function autoModel(): Promise<string | null> {
  try {
    return pickTranslateModelFrom(await listModels())
  } catch {
    return null
  }
}

/** Steps 2–4 — translate the STORED doc for this page into langCode. */
export async function runTranslate(
  wc: WebContents,
  langCode: string,
  model: string | null
): Promise<void> {
  const doc = store.get(wc.id)
  if (!doc) throw new Error('No captured page — open a web page and choose Translate first')
  const lang = isLangCode(langCode) ? langCode.toLowerCase() : 'en'
  if (doc.running) return // one run at a time; the page UI prevents this too

  // same language + already done? refresh the page's copy without rework
  const doneCount = doc.out.filter(Boolean).length
  if (doc.langCode === lang && doneCount === doc.paras.length && !doc.error) {
    doc.running = false
    doc.error = null
    sendUpdate(wc, doc)
    return
  }

  // stop any previous run on this page
  runs.get(wc.id)?.abort()
  const ctrl = new AbortController()
  runs.set(wc.id, ctrl)

  doc.langCode = lang
  doc.out = doc.paras.map(() => '')
  doc.error = null
  doc.running = true
  doc.model = model || null
  sendUpdate(wc, doc)

  const chunks = makeTranslateChunks(doc.paras)
  let cursor = 0
  try {
    const model = doc.model || (await autoModel())
    doc.model = model
    if (!model) throw new Error('Ollama is not reachable — start Ollama (or set the cloud fallback in Settings) and try again.')
    for (const chunk of chunks) {
      if (ctrl.signal.aborted) throw new Error('Aborted.')
      let answer = ''
      for await (const delta of chatStream(
        model,
        [
          { role: 'system', content: TRANSLATE_SYSTEM },
          { role: 'user', content: buildTranslatePrompt(chunk, lang) }
        ],
        ctrl.signal
      )) {
        answer += delta
      }
      const parsed = parseTranslatedChunk(answer, chunk.length, chunk)
      for (let i = 0; i < chunk.length && cursor + i < doc.out.length; i++) {
        doc.out[cursor + i] = parsed[i] || ''
      }
      cursor += chunk.length
      sendUpdate(wc, doc)
    }
    doc.running = false
  } catch (err) {
    doc.running = false
    doc.error = ctrl.signal.aborted ? null : err instanceof Error ? err.message : String(err)
  } finally {
    runs.delete(wc.id)
    sendUpdate(wc, doc)
  }
}

export function stopTranslate(wcId: number): void {
  runs.get(wcId)?.abort()
  const doc = store.get(wcId)
  if (doc && doc.running) {
    doc.running = false
    doc.error = null
  }
}
