/**
 * VRAM calculator for the Model Manager v2 (Master Plan Phase 4, item #79).
 *
 * Pure, dependency-free, deliberately CONSERVATIVE (over-estimates slightly
 * so "fits in 8 GB" claims don't embarrass the browser). Formula:
 *
 *   weights = params(B) × bytesPerWeight(quant)
 *   kvCache = ctxTokens/1024 × params(B) × 0.03 GB per 1k tokens (heuristic)
 *   overhead = 0.6 GB (runtime + compute buffers)
 *
 * KV calibration: Llama-3-8B fp16 KV @ 8k ctx is ~1.07 GB in reality; this
 * heuristic yields ~1.9 GB (≈1.8× reality) — conservative but not absurd.
 *
 * bytesPerWeight: 4-bit ≈ 0.55 (incl. small dense layers), 5-bit ≈ 0.68,
 * 8-bit ≈ 1.05, 16-bit ≈ 2.0.
 */
export interface VramInput {
  /** parameter count in billions (e.g. 8 for an 8B model) */
  paramsB: number
  /** weight quantization: 4 | 5 | 8 | 16 */
  quantBits: 4 | 5 | 8 | 16
  /** context window in tokens (default 8192) */
  ctxTokens?: number
}

export interface VramEstimate {
  weightsGB: number
  kvGB: number
  overheadGB: number
  totalGB: number
  /** verdict buckets the UI renders */
  verdict: 'tiny' | 'small' | 'medium' | 'large' | 'huge'
}

const BYTES_PER_WEIGHT: Record<VramInput['quantBits'], number> = {
  4: 0.55,
  5: 0.68,
  8: 1.05,
  16: 2.0
}

export function estimateVram(input: VramInput): VramEstimate {
  const params = Math.max(0, Number(input?.paramsB) || 0)
  const quant: VramInput['quantBits'] = [4, 5, 8, 16].includes(Number(input?.quantBits)) ? (Number(input?.quantBits) as VramInput['quantBits']) : 4
  const ctx = Math.max(0, Number(input?.ctxTokens) || 8192)
  const weightsGB = params * BYTES_PER_WEIGHT[quant]
  const kvGB = (ctx / 1024) * params * 0.03
  const overheadGB = 0.6
  const totalGB = Math.round((weightsGB + kvGB + overheadGB) * 10) / 10
  let verdict: VramEstimate['verdict'] = 'huge'
  if (totalGB < 3) verdict = 'tiny'
  else if (totalGB < 6) verdict = 'small'
  else if (totalGB < 12) verdict = 'medium'
  else if (totalGB < 24) verdict = 'large'
  return { weightsGB: Math.round(weightsGB * 10) / 10, kvGB: Math.round(kvGB * 10) / 10, overheadGB, totalGB, verdict }
}

/** Parse common model-name size hints: "qwen3.5:9b", "llama3.1-70b-instruct" */
export function paramsFromModelName(name: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*b\b/i.exec(String(name || ''))
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Parse quantization from a GGUF-style tag: "…q4_K_M", "…q8_0", "…Q5_K_S" */
export function quantFromModelName(name: string): 4 | 5 | 8 | 16 | null {
  const m = /q(\d)(?:_\w+)?/i.exec(String(name || ''))
  if (!m) return null
  const n = Number(m[1])
  return n === 4 || n === 5 || n === 8 ? n : n === 6 ? 5 : null // q6 ≈ 5-bit class
}
