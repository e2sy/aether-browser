/**
 * Full-page translate (v2.6.0 build 20) — pure core.
 *
 * Aether translates web pages with the user's OWN local Ollama model — no
 * cloud translation service ever sees the page. This module holds the
 * language list, chunking, the numbered-line prompt and the response parser
 * so the network round-trip in main/translate.ts stays thin and the whole
 * pipeline is unit-testable.
 */

export interface TranslateLang {
  code: string
  name: string
  /** optional native name shown in the picker */
  native?: string
}

/** The language menu — world coverage + the 8th-schedule Indian languages. */
export const LANGUAGES: TranslateLang[] = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'fa', name: 'Persian', native: 'فارسی' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'fil', name: 'Filipino' }
]

/** Pure: language display name by code (falls back to the raw code). */
export function langName(code: string): string {
  const hit = LANGUAGES.find((l) => l.code === String(code || '').toLowerCase())
  return hit ? hit.name : String(code || 'English')
}

/** Pure: is this a code we offer? (guards the IPC input) */
export function isLangCode(code: unknown): code is string {
  return typeof code === 'string' && LANGUAGES.some((l) => l.code === code.toLowerCase())
}

/** Paragraph caps — keeps a 9B model's translate time sane. */
export const MAX_PARAS = 600
export const MAX_TEXT_CHARS = 60_000
/** lines per Ollama request */
export const CHUNK_LINES = 6

/**
 * Pure: split the page's paragraphs into numbered-line chunks.
 * Empty/oversized paragraphs are dropped first; the last chunk may be short.
 */
export function makeTranslateChunks(paras: string[], linesPerChunk = CHUNK_LINES): string[][] {
  const clean = (paras || [])
    .map((p) => String(p || '').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.length > 1200 ? p.slice(0, 1200) + '…' : p))
  const size = Math.min(24, Math.max(1, Math.floor(linesPerChunk) || CHUNK_LINES))
  const out: string[][] = []
  for (let i = 0; i < clean.length && i < MAX_PARAS; i += size) {
    out.push(clean.slice(i, i + size))
  }
  return out
}

/** Pure: the numbered-line translation prompt for one chunk. */
export function buildTranslatePrompt(lines: string[], targetLang: string): string {
  const lang = langName(targetLang)
  const body = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
  return (
    `Translate each numbered line below into ${lang}. ` +
    `Rules: reply with ONLY the numbered lines (${lines.length} of them), same order, ` +
    `each in the format "N. translation"; translate naturally (not word-for-word); ` +
    `keep names, code and URLs as-is; never add notes or explanations.\n\n${body}`
  )
}

export const TRANSLATE_SYSTEM =
  'You are a translation engine. You output translated numbered lines only — no commentary, no preamble, no closing remarks.'

/**
 * Pure: parse a translated chunk back into lines aligned with the input.
 * Accepts "1. x", "1) x", "1 - x" and bare-line fallbacks. When a line is
 * missing or the model miscounted, the ORIGINAL text is kept for that slot
 * (graceful degradation beats a broken page).
 */
export function parseTranslatedChunk(out: string, expected: number, originals: string[]): string[] {
  const text = String(out || '').trim()
  if (!text) return [...originals]
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const byNum = new Map<number, string>()
  const bare: string[] = []
  for (const line of lines) {
    const m = /^(\d{1,3})\s*[.)\-–:]\s*(.+)$/.exec(line)
    if (m) {
      const n = Number(m[1])
      if (n >= 1 && n <= expected && !byNum.has(n)) byNum.set(n, m[2].trim())
    } else {
      bare.push(line)
    }
  }
  const result: string[] = []
  let bareIdx = 0
  for (let i = 1; i <= expected; i++) {
    const hit = byNum.get(i)
    if (hit) {
      result.push(hit)
    } else if (byNum.size === 0 && bare.length === expected) {
      // model ignored numbering but returned the right count — take in order
      result.push(bare[bareIdx++])
    } else {
      result.push(originals[i - 1] ?? '')
    }
  }
  return result
}

/**
 * Pure: how far along is a run — used by the translate page's progress bar.
 * Returns a 0..100 integer.
 */
export function progressPct(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)))
}
