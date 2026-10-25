/**
 * Search depth modes (Master Plan Phase 4, item #78) — quick / deep /
 * academic / code. Pure policy (prompt shaping + source budget); unit-tested.
 */

export type SearchDepth = 'quick' | 'deep' | 'academic' | 'code'

export const SEARCH_DEPTHS: readonly SearchDepth[] = ['quick', 'deep', 'academic', 'code']

export function isSearchDepth(v: unknown): v is SearchDepth {
  return typeof v === 'string' && (SEARCH_DEPTHS as readonly string[]).includes(v)
}

/** How many web results feed the model per depth. */
export function depthSourceCount(depth: SearchDepth): number {
  switch (depth) {
    case 'deep':
      return 14
    case 'academic':
      return 10
    case 'code':
      return 10
    default:
      return 6
  }
}

/** Prompt shaping per depth (appended to the base search system prompt). */
export function depthPrompt(depth: SearchDepth): string {
  switch (depth) {
    case 'deep':
      return [
        'Depth mode: DEEP — the user wants a thorough answer.',
        '- Read all the results before answering; synthesize across them.',
        '- Structure the answer with short section headers or bullets.',
        '- Cover counterpoints or caveats when the sources mention them.',
        '- Up to 500 words; cite every claim as [n].'
      ].join('\n')
    case 'academic':
      return [
        'Depth mode: ACADEMIC — answer like a careful literature review.',
        '- Prefer .edu/.gov results, journals, encyclopedic sources when present.',
        '- Separate ESTABLISHED claims from CONTESTED ones.',
        '- Name the source of each key claim inline as [n]; add a "Sources" list at the end.',
        '- Flag low-confidence or thinly-sourced statements explicitly.'
      ].join('\n')
    case 'code':
      return [
        'Depth mode: CODE — the user is debugging or building.',
        '- Prefer official docs, GitHub issues, Stack Overflow and changelogs when present.',
        '- Give a minimal working code example in a fenced block when the question allows.',
        '- State exact version numbers / API names found in the sources; cite as [n].',
        '- Warn when a source may be outdated (mention the date/version it references).'
      ].join('\n')
    default:
      return ''
  }
}

/** Re-rank heuristics: does this result get a small boost for the depth? */
export function depthBoost(depth: SearchDepth, url: string): number {
  let u = ''
  try {
    u = new URL(url).hostname.toLowerCase()
  } catch {
    return 0
  }
  switch (depth) {
    case 'academic':
      if (u.endsWith('.edu') || u.endsWith('.gov') || u.includes('wikipedia') || u.includes('arxiv') || u.includes('scholar')) return 2
      return 0
    case 'code':
      if (u.includes('github') || u.includes('stackoverflow') || u.includes('developer.mozilla') || u.includes('docs.')) return 2
      return 0
    default:
      return 0
  }
}
