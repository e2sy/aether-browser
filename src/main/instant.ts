/**
 * Instant answers v2 for Aether Search (v1.6.0 Beast Mode).
 *
 * Beyond the v1.3 calculator, the search box now answers — entirely on
 * device, no network, no telemetry:
 *
 *   10 km to miles        → unit conversion (length/mass/temp/speed/data/volume)
 *   72 f to c             → temperature, compact form supported
 *   15% of 80             → percentages
 *   time in tokyo         → world clock via the Intl timezone database
 *   date                  → today, on this device
 *
 * Everything is pure and deterministic given the injected `now`, so tests
 * assert exact strings. Nothing here mutates module state.
 */

/* -------------------------------- units --------------------------------- */

interface UnitDef {
  /** canonical dimension this unit belongs to */
  dim: string
  /** how many BASE units one of these is (base: meter, kg, m/s, byte, liter) */
  factor: number
  /** display label for the base-unit spelling of a result */
  aliases: string[]
}

/** Base units: meter (length), kilogram (mass), m/s (speed), byte (data), liter (volume). */
const UNITS: Record<string, UnitDef> = {
  // length (base meter)
  mm: { dim: 'len', factor: 0.001, aliases: ['millimeters'] },
  cm: { dim: 'len', factor: 0.01, aliases: ['centimeters'] },
  m: { dim: 'len', factor: 1, aliases: ['meters', 'meter'] },
  km: { dim: 'len', factor: 1000, aliases: ['kilometers'] },
  in: { dim: 'len', factor: 0.0254, aliases: ['inches', 'inch'] },
  inch: { dim: 'len', factor: 0.0254, aliases: ['inches'] },
  inches: { dim: 'len', factor: 0.0254, aliases: ['inches'] },
  ft: { dim: 'len', factor: 0.3048, aliases: ['feet', 'foot'] },
  foot: { dim: 'len', factor: 0.3048, aliases: ['feet'] },
  feet: { dim: 'len', factor: 0.3048, aliases: ['feet'] },
  yd: { dim: 'len', factor: 0.9144, aliases: ['yards'] },
  yard: { dim: 'len', factor: 0.9144, aliases: ['yards'] },
  yards: { dim: 'len', factor: 0.9144, aliases: ['yards'] },
  mi: { dim: 'len', factor: 1609.344, aliases: ['miles'] },
  mile: { dim: 'len', factor: 1609.344, aliases: ['miles'] },
  miles: { dim: 'len', factor: 1609.344, aliases: ['miles'] },
  nmi: { dim: 'len', factor: 1852, aliases: ['nautical miles'] },
  // mass (base kilogram)
  mg: { dim: 'mass', factor: 1e-6, aliases: ['milligrams'] },
  g: { dim: 'mass', factor: 0.001, aliases: ['grams'] },
  gram: { dim: 'mass', factor: 0.001, aliases: ['grams'] },
  grams: { dim: 'mass', factor: 0.001, aliases: ['grams'] },
  kg: { dim: 'mass', factor: 1, aliases: ['kilograms'] },
  kilogram: { dim: 'mass', factor: 1, aliases: ['kilograms'] },
  kilograms: { dim: 'mass', factor: 1, aliases: ['kilograms'] },
  t: { dim: 'mass', factor: 1000, aliases: ['tonnes'] },
  tonne: { dim: 'mass', factor: 1000, aliases: ['tonnes'] },
  oz: { dim: 'mass', factor: 0.028349523125, aliases: ['ounces'] },
  ounce: { dim: 'mass', factor: 0.028349523125, aliases: ['ounces'] },
  ounces: { dim: 'mass', factor: 0.028349523125, aliases: ['ounces'] },
  lb: { dim: 'mass', factor: 0.45359237, aliases: ['pounds'] },
  lbs: { dim: 'mass', factor: 0.45359237, aliases: ['pounds'] },
  pound: { dim: 'mass', factor: 0.45359237, aliases: ['pounds'] },
  pounds: { dim: 'mass', factor: 0.45359237, aliases: ['pounds'] },
  st: { dim: 'mass', factor: 6.35029318, aliases: ['stone'] },
  stone: { dim: 'mass', factor: 6.35029318, aliases: ['stone'] },
  // speed (base m/s)
  kmh: { dim: 'speed', factor: 1 / 3.6, aliases: ['km/h'] },
  'km/h': { dim: 'speed', factor: 1 / 3.6, aliases: ['km/h'] },
  kph: { dim: 'speed', factor: 1 / 3.6, aliases: ['km/h'] },
  mph: { dim: 'speed', factor: 0.44704, aliases: ['mph'] },
  'mi/h': { dim: 'speed', factor: 0.44704, aliases: ['mph'] },
  'm/s': { dim: 'speed', factor: 1, aliases: ['m/s'] },
  knot: { dim: 'speed', factor: 0.514444, aliases: ['knots'] },
  knots: { dim: 'speed', factor: 0.514444, aliases: ['knots'] },
  kn: { dim: 'speed', factor: 0.514444, aliases: ['knots'] },
  // time (base second) — "ms" is milliseconds, NOT m/s (see 'm/s' above)
  ms: { dim: 'time', factor: 0.001, aliases: ['milliseconds'] },
  millisecond: { dim: 'time', factor: 0.001, aliases: ['milliseconds'] },
  milliseconds: { dim: 'time', factor: 0.001, aliases: ['milliseconds'] },
  s: { dim: 'time', factor: 1, aliases: ['seconds'] },
  sec: { dim: 'time', factor: 1, aliases: ['seconds'] },
  secs: { dim: 'time', factor: 1, aliases: ['seconds'] },
  second: { dim: 'time', factor: 1, aliases: ['seconds'] },
  seconds: { dim: 'time', factor: 1, aliases: ['seconds'] },
  min: { dim: 'time', factor: 60, aliases: ['minutes'] },
  mins: { dim: 'time', factor: 60, aliases: ['minutes'] },
  minute: { dim: 'time', factor: 60, aliases: ['minutes'] },
  minutes: { dim: 'time', factor: 60, aliases: ['minutes'] },
  h: { dim: 'time', factor: 3600, aliases: ['hours'] },
  hr: { dim: 'time', factor: 3600, aliases: ['hours'] },
  hrs: { dim: 'time', factor: 3600, aliases: ['hours'] },
  hour: { dim: 'time', factor: 3600, aliases: ['hours'] },
  hours: { dim: 'time', factor: 3600, aliases: ['hours'] },
  day: { dim: 'time', factor: 86400, aliases: ['days'] },
  days: { dim: 'time', factor: 86400, aliases: ['days'] },
  week: { dim: 'time', factor: 604800, aliases: ['weeks'] },
  weeks: { dim: 'time', factor: 604800, aliases: ['weeks'] },
  // data (base byte)
  b: { dim: 'data', factor: 1, aliases: ['bytes'] },
  kb: { dim: 'data', factor: 1000, aliases: ['kilobytes'] },
  mb: { dim: 'data', factor: 1e6, aliases: ['megabytes'] },
  gb: { dim: 'data', factor: 1e9, aliases: ['gigabytes'] },
  tb: { dim: 'data', factor: 1e12, aliases: ['terabytes'] },
  kib: { dim: 'data', factor: 1024, aliases: ['kibibytes'] },
  mib: { dim: 'data', factor: 1024 ** 2, aliases: ['mebibytes'] },
  gib: { dim: 'data', factor: 1024 ** 3, aliases: ['gibibytes'] },
  // volume (base liter)
  ml: { dim: 'vol', factor: 0.001, aliases: ['milliliters'] },
  l: { dim: 'vol', factor: 1, aliases: ['liters'] },
  liter: { dim: 'vol', factor: 1, aliases: ['liters'] },
  liters: { dim: 'vol', factor: 1, aliases: ['liters'] },
  litre: { dim: 'vol', factor: 1, aliases: ['liters'] },
  litres: { dim: 'vol', factor: 1, aliases: ['liters'] },
  gal: { dim: 'vol', factor: 3.785411784, aliases: ['US gallons'] },
  gallon: { dim: 'vol', factor: 3.785411784, aliases: ['US gallons'] },
  gallons: { dim: 'vol', factor: 3.785411784, aliases: ['US gallons'] },
  cup: { dim: 'vol', factor: 0.2365882365, aliases: ['US cups'] },
  cups: { dim: 'vol', factor: 0.2365882365, aliases: ['US cups'] }
}

// temperatures are special-cased (non-linear)
const TEMP_UNITS: Record<string, string> = {
  c: 'c', celsius: 'c', centigrade: 'c', '°c': 'c',
  f: 'f', fahrenheit: 'f', '°f': 'f',
  k: 'k', kelvin: 'k'
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`
const OPT_WS = String.raw`\s*`

/** Parse "10 km to miles" / "72f to c" / "10 kilometers in miles" → components. */
export function parseUnitQuery(q: string): { value: number; from: string; to: string } | null {
  const s = String(q || '').trim().toLowerCase().replace(/[?！?]+\s*$/, '').trim()
  const m = new RegExp(`^${NUM}${OPT_WS}([a-z°/]+)${OPT_WS}(?:to|in)${OPT_WS}([a-z°/]+)$`).exec(s)
  if (!m) return null
  const value = parseFloat(m[1])
  if (!Number.isFinite(value)) return null
  const from = m[2]
  const to = m[3]
  if (!from || !to || from === to) return null
  return { value, from, to }
}

function tempConvert(v: number, from: string, to: string): number | null {
  const f = TEMP_UNITS[from]
  const t = TEMP_UNITS[to]
  if (!f || !t || f === t) return null
  const c = f === 'c' ? v : f === 'f' ? (v - 32) * (5 / 9) : v - 273.15
  const out = t === 'c' ? c : t === 'f' ? c * (9 / 5) + 32 : c + 273.15
  return out
}

function fmtValue(v: number): string {
  const r = Math.round(v * 1e6) / 1e6
  return String(r)
}

export interface UnitAnswer {
  kind: 'unit'
  input: string
  output: string
  detail: string
}

/** Convert "10 km to miles" → answer, or null when the query is not a unit pair. */
export function unitAnswer(q: string): UnitAnswer | null {
  const p = parseUnitQuery(q)
  if (!p) return null
  const input = `${fmtValue(p.value)} ${p.from} → ${p.to}`

  // temperature: special-cased, non-linear
  if (TEMP_UNITS[p.from] || TEMP_UNITS[p.to]) {
    const out = tempConvert(p.value, p.from, p.to)
    if (out === null) return null
    return { kind: 'unit', input, output: `${fmtValue(out)}°${p.to.toUpperCase()}`, detail: 'temperature' }
  }

  const from = UNITS[p.from]
  const to = UNITS[p.to]
  if (!from || !to || from.dim !== to.dim) return null
  const base = p.value * from.factor
  const out = base / to.factor
  return {
    kind: 'unit',
    input,
    output: `${fmtValue(out)} ${to.aliases[0]}`,
    detail:
      from.dim === 'len'
        ? 'length'
        : from.dim === 'mass'
          ? 'mass'
          : from.dim === 'speed'
            ? 'speed'
            : from.dim === 'data'
              ? 'data'
              : from.dim === 'time'
                ? 'time'
                : 'volume'
  }
}

/* ------------------------------ percentages ------------------------------ */

export interface PercentAnswer {
  kind: 'percent'
  input: string
  output: string
}

/** "15% of 80", "15 percent of 80", "what is 15% of 80" → 12. */
export function percentAnswer(q: string): PercentAnswer | null {
  const s = String(q || '')
    .toLowerCase()
    .replace(/^(what\s+is|what's|calculate|calc|compute)\s+/, '')
    .replace(/[?！?]+\s*$/, '')
    .trim()
  const m = new RegExp(`^${NUM}${OPT_WS}(?:%|percent|pct)${OPT_WS}of${OPT_WS}${NUM}$`).exec(s)
  if (!m) return null
  const pct = parseFloat(m[1])
  const of = parseFloat(m[2])
  if (!Number.isFinite(pct) || !Number.isFinite(of)) return null
  const out = Math.round((pct / 100) * of * 1e6) / 1e6
  return { kind: 'percent', input: `${fmtValue(pct)}% of ${fmtValue(of)}`, output: fmtValue(out) }
}

/* --------------------------------- time --------------------------------- */

/**
 * City → IANA timezone. A deliberately opinionated list: every Indian
 * metro, the world's capitals and big cities a search box actually gets
 * asked about. `Intl.DateTimeFormat` carries the real DST rules, so New
 * York/London shift correctly all year.
 */
export const CITY_TZ: Record<string, string> = {
  delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', mumbai: 'Asia/Kolkata', bombay: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata', calcutta: 'Asia/Kolkata', chennai: 'Asia/Kolkata', madras: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', hyderabad: 'Asia/Kolkata', pune: 'Asia/Kolkata',
  ahmedabad: 'Asia/Kolkata', jaipur: 'Asia/Kolkata', lucknow: 'Asia/Kolkata', indore: 'Asia/Kolkata',
  goa: 'Asia/Kolkata', kochi: 'Asia/Kolkata', cochin: 'Asia/Kolkata', chandigarh: 'Asia/Kolkata',
  colombo: 'Asia/Colombo', kathmandu: 'Asia/Kathmandu', dhaka: 'Asia/Dhaka', karachi: 'Asia/Karachi',
  islamabad: 'Asia/Karachi', lahore: 'Asia/Karachi',
  london: 'Europe/London', paris: 'Europe/Paris', berlin: 'Europe/Berlin', munich: 'Europe/Berlin',
  madrid: 'Europe/Madrid', barcelona: 'Europe/Madrid', rome: 'Europe/Rome', milan: 'Europe/Rome',
  amsterdam: 'Europe/Amsterdam', brussels: 'Europe/Brussels', vienna: 'Europe/Vienna',
  zurich: 'Europe/Zurich', geneva: 'Europe/Zurich', stockholm: 'Europe/Stockholm', oslo: 'Europe/Oslo',
  copenhagen: 'Europe/Copenhagen', helsinki: 'Europe/Helsinki', dublin: 'Europe/Dublin',
  lisbon: 'Europe/Lisbon', warsaw: 'Europe/Warsaw', prague: 'Europe/Prague', budapest: 'Europe/Budapest',
  athens: 'Europe/Athens', istanbul: 'Europe/Istanbul', kyiv: 'Europe/Kyiv', kiev: 'Europe/Kyiv',
  moscow: 'Europe/Moscow', 'st petersburg': 'Europe/Moscow', bucharest: 'Europe/Bucharest',
  'new york': 'America/New_York', nyc: 'America/New_York', boston: 'America/New_York',
  washington: 'America/New_York', philadelphia: 'America/New_York', miami: 'America/New_York',
  atlanta: 'America/New_York', toronto: 'America/Toronto', montreal: 'America/Toronto',
  chicago: 'America/Chicago', houston: 'America/Chicago', dallas: 'America/Chicago',
  austin: 'America/Chicago', denver: 'America/Denver', phoenix: 'America/Phoenix',
  'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles', portland: 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles',
  vancouver: 'America/Vancouver', 'mexico city': 'America/Mexico_City',
  'sao paulo': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires',
  santiago: 'America/Santiago', bogota: 'America/Bogota', lima: 'America/Lima', caracas: 'America/Caracas',
  dubai: 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', doha: 'Asia/Qatar', riyadh: 'Asia/Riyadh',
  kuwait: 'Asia/Kuwait', muscat: 'Asia/Muscat', tehran: 'Asia/Tehran', baghdad: 'Asia/Baghdad',
  jerusalem: 'Asia/Jerusalem', 'tel aviv': 'Asia/Jerusalem',
  singapore: 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai', taipei: 'Asia/Taipei', seoul: 'Asia/Seoul', tokyo: 'Asia/Tokyo',
  osaka: 'Asia/Tokyo', bangkok: 'Asia/Bangkok', jakarta: 'Asia/Jakarta', 'kuala lumpur': 'Asia/Kuala_Lumpur',
  manila: 'Asia/Manila', 'ho chi minh': 'Asia/Ho_Chi_Minh', hanoi: 'Asia/Ho_Chi_Minh',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', brisbane: 'Australia/Brisbane',
  perth: 'Australia/Perth', auckland: 'Pacific/Auckland', wellington: 'Pacific/Auckland',
  honolulu: 'Pacific/Honolulu', cairo: 'Africa/Cairo', lagos: 'Africa/Lagos', nairobi: 'Africa/Nairobi',
  johannesburg: 'Africa/Johannesburg', 'cape town': 'Africa/Johannesburg', casablanca: 'Africa/Casablanca',
  accra: 'Africa/Accra', utc: 'UTC', gmt: 'UTC'
}

export interface TimeAnswer {
  kind: 'time'
  input: string
  output: string
  detail: string
}

const TZ_LABEL: Record<string, string> = {
  'Asia/Kolkata': 'India Standard Time',
  'Asia/Tokyo': 'Japan Standard Time',
  'America/New_York': 'US Eastern',
  'America/Los_Angeles': 'US Pacific',
  'Europe/London': 'United Kingdom',
  UTC: 'UTC'
}

function tzOffsetLabel(tz: string, now: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    const part = fmt.formatToParts(now).find((p) => p.type === 'timeZoneName')
    return part ? part.value : ''
  } catch {
    return ''
  }
}

/**
 * "time in tokyo" / "what time is it in london" / "time" (local) / "date".
 * Deterministic for a fixed `now` — tests inject one.
 */
export function timeAnswer(q: string, now: Date = new Date()): TimeAnswer | null {
  const s = String(q || '').trim().toLowerCase().replace(/[?！?]+\s*$/, '').trim()
  if (!s) return null

  // "date" / "today's date" / "what is the date"
  if (/^(what('| i)?s the |the )?date( today| now)?$/.test(s) || s === "today's date") {
    const out = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(now)
    return { kind: 'time', input: s, output: out, detail: 'on this device (UTC)' }
  }

  const m = /^(?:(?:what(?:'s| is|s)?)(?:\s+the)?\s+)?(?:current\s+)?time(?:\s+is\s+it)?(?:\s+(?:in|at|for)\s+(.+))?$/.exec(s)
  if (!m) return null
  const cityRaw = (m[1] || '').trim().replace(/[.]+$/, '')
  if (!cityRaw) {
    const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
    return { kind: 'time', input: s, output: `${time}`, detail: `your timezone · ${date}` }
  }
  const tz = CITY_TZ[cityRaw] || CITY_TZ[cityRaw.replace(/\s+/g, ' ')]
  if (!tz) return null
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(now)
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short'
  }).format(now)
  const off = tzOffsetLabel(tz, now)
  const label = TZ_LABEL[tz] || cityRaw.replace(/\b\w/g, (c) => c.toUpperCase())
  return { kind: 'time', input: `time in ${cityRaw}`, output: time, detail: `${label} · ${day}${off ? ' · ' + off : ''}` }
}

/* ------------------------------- dispatch ------------------------------- */

export type Instant =
  | { kind: 'calc'; input: string; output: string }
  | UnitAnswer
  | PercentAnswer
  | TimeAnswer
  | { kind: 'bang'; input: string; output: string; url: string; name: string }

/**
 * One dispatcher the search page (and the omnibox) call. Order matters:
 * calculator first (pure math beats unit-looking text), then percent, unit,
 * time. `resolveBang` from ./bangs is wired in by ipc.ts which owns both.
 */
export function instantAnswerV2(
  q: string,
  deps: { evaluateMath: (s: string) => number | null },
  now: Date = new Date()
): Instant | null {
  const s = String(q || '').trim()
  if (!s) return null

  // 1. calculator (reuse the v1.3 safe evaluator via injected dep)
  const stripped = s
    .replace(/[?！?]+\s*$/, '')
    .replace(/\s*=\s*$/, '')
    .replace(/^(what\s+is|what's|calculate|calc|compute|solve)\s+/i, '')
    .trim()
  if (stripped && /\d/.test(stripped) && /^[0-9\s+\-*/%^().a-z_,]+$/i.test(stripped)) {
    const v = deps.evaluateMath(stripped)
    if (v !== null) {
      const rounded = Math.round(v * 1e10) / 1e10
      return { kind: 'calc', input: stripped, output: String(rounded) }
    }
  }

  // 2. percent
  const pct = percentAnswer(s)
  if (pct) return pct

  // 3. units
  const unit = unitAnswer(s)
  if (unit) return unit

  // 4. time
  const time = timeAnswer(s, now)
  if (time) return time

  return null
}
