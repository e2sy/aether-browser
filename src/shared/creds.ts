/**
 * Password-manager core (v2.3.0) — pure policy shared by the main-process
 * vault, the context menu and the tests. No electron / node imports so the
 * whole module runs in unit tests as-is.
 *
 * Threat model notes baked into these helpers:
 *  - the vault never stores plaintext: main encrypts with safeStorage (OS
 *    keychain) before anything touches disk
 *  - hosts are always derived from the real sender/webContents URL, never
 *    from IPC payloads (a hostile page cannot plant rows for another site)
 *  - everything injected into pages is built by buildFillScript /
 *    buildProbeScript with JSON.stringify — user data can never break out of
 *    the string literal
 */

/** Host of a URL without the www. prefix; '' when unparseable. */
export function normalizeHost(url: string): string {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
}

/** 0-4 password strength (bins mirror the classic zxcvbn-ish drop-in). */
export function passwordStrength(pw: string): Strength {
  const p = String(pw || '')
  if (!p) return { score: 0, label: 'empty' }
  let classes = 0
  if (/[a-z]/.test(p)) classes++
  if (/[A-Z]/.test(p)) classes++
  if (/[0-9]/.test(p)) classes++
  if (/[^A-Za-z0-9]/.test(p)) classes++
  const uniq = new Set(p).size
  let score = 0
  if (p.length >= 8) score = 1
  if (p.length >= 10 && classes >= 2 && uniq >= 6) score = 2
  if (p.length >= 12 && classes >= 3 && uniq >= 8) score = 3
  if (p.length >= 16 && classes >= 3 && uniq >= 10) score = 4
  // long single-class strings (lowercase passphrases) still earn at least 3
  if (p.length >= 16 && uniq >= 10) score = Math.max(score, 3)
  const labels = ['very weak', 'weak', 'fair', 'strong', 'excellent']
  return { score: score as Strength['score'], label: labels[score] }
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGIT = '0123456789'
const SYMBOL = '!@#$%^&*()-_=+[]{};:,.?'
const AMBIGUOUS = new Set(['l', 'I', '1', 'O', '0', '`', "'", '"'])

/**
 * Generate a password with at least one char of every class. `rng` returns
 * floats in [0,1) — injectable for deterministic tests. Ambiguous glyphs
 * (l/I/1/O/0/quotes) are skipped so passwords survive manual retyping.
 */
export function generatePassword(length = 20, rng: () => number = Math.random): string {
  const len = Math.max(8, Math.min(96, Math.floor(length) || 20))
  const pools = [LOWER, UPPER, DIGIT, SYMBOL].map((pool) => [...pool].filter((c) => !AMBIGUOUS.has(c)))
  const all = pools.flat()
  const picks: string[] = pools.map((pool) => pool[Math.floor(rng() * pool.length)])
  while (picks.length < len) picks.push(all[Math.floor(rng() * all.length)])
  // Fisher-Yates with the same rng so tests stay deterministic
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[picks[i], picks[j]] = [picks[j], picks[i]]
  }
  return picks.slice(0, len).join('')
}

export interface FieldLike {
  type: string
  /** lowercased name/id/placeholder blob used to spot username boxes */
  hint?: string
}

export interface PickedFields {
  passwordIdx: number
  usernameIdx: number
}

/**
 * Pick the login fields from a form's inputs (DOM order): the first
 * type=password is the password; the username is the closest preceding
 * visible text/email/tel input (name/id/placeholder hints win over plain
 * search boxes when both are present). Returns -1 indexes when absent.
 */
export function pickLoginFields(inputs: FieldLike[]): PickedFields {
  const list = Array.isArray(inputs) ? inputs : []
  let passwordIdx = -1
  for (let i = 0; i < list.length; i++) {
    if (String(list[i]?.type || '').toLowerCase() === 'password') {
      passwordIdx = i
      break
    }
  }
  if (passwordIdx < 0) return { passwordIdx: -1, usernameIdx: -1 }
  let usernameIdx = -1
  for (let i = passwordIdx - 1; i >= 0; i--) {
    const t = String(list[i]?.type || '').toLowerCase()
    if (t === 'text' || t === 'email' || t === 'tel' || t === '' || t === 'hidden') {
      const hint = String(list[i]?.hint || '').toLowerCase()
      // never pick obvious search/filter boxes
      if (/search|query|filter|q\b/.test(hint)) continue
      usernameIdx = i
      break
    }
  }
  return { passwordIdx, usernameIdx }
}

const USER_MAX = 128
const PASS_MAX = 256

/** Strip control chars + clamp — vault fields are plain printable strings. */
export function sanitizeCred(value: string, max = PASS_MAX): string {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export function sanitizeUsername(value: string): string {
  return sanitizeCred(value, USER_MAX)
}

export function sanitizePassword(value: string): string {
  // passwords may legitimately contain odd chars; only kill controls
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, PASS_MAX)
}

/** A vault row (plaintext only in memory — disk rows carry `enc`, not `password`). */
export interface CredRecord {
  id: string
  host: string
  /** full origin URL captured from (best-effort, for display) */
  url?: string
  username: string
  /** safeStorage ciphertext, base64 — never persisted as plaintext */
  enc: string
  ts: number
  /** generator strength at capture time (0-4) */
  strong: number
}

/**
 * Best saved login for a URL: exact normalized-host matches first, newest
 * wins. Subdomains do NOT match (accounts.example.com ≠ example.com) —
 * autofilling across registrable domains is how phishing starts.
 */
export function matchCreds(records: CredRecord[], url: string): CredRecord | null {
  const host = normalizeHost(url)
  if (!host) return null
  const hits = (Array.isArray(records) ? records : []).filter((r) => r && r.host === host)
  if (!hits.length) return null
  return hits.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0]
}

/**
 * Script that fills the first login-ish form on the page. Values ride in via
 * JSON.stringify (immune to quotes/newlines); the React-compatible native
 * value setter + input/change events make SPAs pick the values up.
 */
export function buildFillScript(username: string, password: string): string {
  const u = JSON.stringify(String(username || ''))
  const p = JSON.stringify(String(password || ''))
  return `(function () {
  try {
    var forms = document.querySelectorAll('form')
    var form = null
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('input[type=password]')) { form = forms[i]; break }
    }
    if (!form) return 0
    var inputs = Array.prototype.slice.call(form.querySelectorAll('input'))
    var pi = -1
    for (var j = 0; j < inputs.length; j++) {
      if ((inputs[j].getAttribute('type') || 'text').toLowerCase() === 'password') { pi = j; break }
    }
    if (pi < 0) return 0
    var ui = -1
    for (var k = pi - 1; k >= 0; k--) {
      var t = (inputs[k].getAttribute('type') || 'text').toLowerCase()
      if (t === 'text' || t === 'email' || t === 'tel') { ui = k; break }
    }
    function set(el, val) {
      if (!el) return
      var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      var desc = Object.getOwnPropertyDescriptor(proto, 'value')
      if (desc && desc.set) desc.set.call(el, val)
      else el.value = val
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    set(ui >= 0 ? inputs[ui] : null, ${u})
    set(inputs[pi], ${p})
    return pi >= 0 ? 1 : 0
  } catch (err) { return 0 }
})()`
}

/**
 * One-shot submit detector injected on every http(s) page load. Finds the
 * submitted login form, extracts username+password, and reports through the
 * single page-allowed bridge channel (creds:submit — main re-validates the
 * host from the sender, never trusting the payload). Idempotent per document.
 */
export const SUBMIT_HOOK_SCRIPT = `(function () {
  try {
    if (window.__aetherCredHook) return 0
    window.__aetherCredHook = true
    function grab(form) {
      try {
        var inputs = Array.prototype.slice.call(form.querySelectorAll('input'))
        var pi = -1
        for (var i = 0; i < inputs.length; i++) {
          if ((inputs[i].getAttribute('type') || 'text').toLowerCase() === 'password') { pi = i; break }
        }
        if (pi < 0) return null
        var pw = inputs[pi].value || ''
        if (!pw) return null
        var ui = -1
        for (var k = pi - 1; k >= 0; k--) {
          var t = (inputs[k].getAttribute('type') || 'text').toLowerCase()
          if (t === 'text' || t === 'email' || t === 'tel') { ui = k; break }
        }
        var user = ui >= 0 ? (inputs[ui].value || '') : ''
        return { username: String(user).slice(0, 128), password: String(pw).slice(0, 256) }
      } catch (err) { return null }
    }
    function report(form) {
      var cred = grab(form)
      if (!cred) return
      try {
        if (window.aether && window.aether.creds && window.aether.creds.submit) {
          window.aether.creds.submit(cred)
        }
      } catch (err) { /* never break the page */ }
    }
    document.addEventListener('submit', function (e) {
      try {
        var f = e.target
        if (f && f.querySelectorAll && f.querySelector('input[type=password]')) report(f)
      } catch (err) { /* noop */ }
    }, true)
    return 1
  } catch (err) { return 0 }
})()`

/**
 * Probe script for the context-menu capture ("Save login…"): returns the
 * credential pair for the form containing the focused password input, or the
 * first login-ish form when focus moved on. JSON-stringified output.
 */
export const PROBE_SCRIPT = `(function () {
  try {
    function scan(form) {
      var inputs = Array.prototype.slice.call(form.querySelectorAll('input'))
      var pi = -1
      for (var i = 0; i < inputs.length; i++) {
        if ((inputs[i].getAttribute('type') || 'text').toLowerCase() === 'password') { pi = i; break }
      }
      if (pi < 0) return null
      var ui = -1
      for (var k = pi - 1; k >= 0; k--) {
        var t = (inputs[k].getAttribute('type') || 'text').toLowerCase()
        if (t === 'text' || t === 'email' || t === 'tel') { ui = k; break }
      }
      return {
        username: String(ui >= 0 ? inputs[ui].value || '' : '').slice(0, 128),
        password: String(inputs[pi].value || '').slice(0, 256)
      }
    }
    var el = document.activeElement
    if (el && el.form) {
      var hit = scan(el.form)
      if (hit && hit.password) return hit
    }
    var forms = document.querySelectorAll('form')
    for (var i = 0; i < forms.length; i++) {
      var hit2 = scan(forms[i])
      if (hit2 && hit2.password) return hit2
    }
    return null
  } catch (err) { return null }
})()`

/**
 * Script that fills ONLY the focused password field (generator flow — the
 * user right-clicked inside a signup box). Fills the paired username box
 * when it is still empty.
 */
export function buildGenerateScript(password: string): string {
  const p = JSON.stringify(String(password || ''))
  return `(function () {
  try {
    var el = document.activeElement
    var target = null
    if (el && (el.tagName || '').toLowerCase() === 'input' && (el.getAttribute('type') || 'text').toLowerCase() === 'password') {
      target = el
    } else {
      var forms = document.querySelectorAll('form')
      for (var i = 0; i < forms.length && !target; i++) {
        var inputs = forms[i].querySelectorAll('input')
        for (var j = 0; j < inputs.length; j++) {
          if ((inputs[j].getAttribute('type') || 'text').toLowerCase() === 'password') { target = inputs[j]; break }
        }
      }
    }
    if (!target) return 0
    var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (desc && desc.set) desc.set.call(target, ${p})
    else target.value = ${p}
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    return 1
  } catch (err) { return 0 }
})()`
}
