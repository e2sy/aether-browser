import { WebContentsView } from 'electron'
import type { PageSnapshot } from '../../shared/types'

/**
 * Runs inside the page: tags interactive elements with data-agent-ref and
 * returns a compact numbered menu the local model can reason over.
 *
 * v0.4: refs are STABLE across snapshots — each element keeps a persistent
 * identity key (stored in window.__aeRefs for the lifetime of the JS context),
 * so the executor can diff snapshots instead of resending full menus, and
 * macros can capture locators that survive re-observation.
 *
 * Keep it dependency-free, ES5-safe, single expression (executeJavaScript).
 */
export const SNIPPET = `(() => {
  try {
    document.querySelectorAll('[data-agent-ref]').forEach(function (e) { e.removeAttribute('data-agent-ref') })
    var sel = 'a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="combobox"],[contenteditable="true"],summary,[onclick]'
    var els = Array.prototype.slice.call(document.querySelectorAll(sel))
    var refs = window.__aeRefs || (window.__aeRefs = {})
    var next = window.__aeNext || 0
    var out = []
    var counts = {}
    function visible(el) {
      var r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return false
      var s = window.getComputedStyle(el)
      return s.visibility !== 'hidden' && s.display !== 'none' && s.pointerEvents !== 'none'
    }
    for (var i = 0; i < els.length && out.length < 120; i++) {
      var el = els[i]
      if (!visible(el)) continue
      if (el.closest && el.closest('[aria-hidden="true"]')) continue
      var text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 80)
      var tag = el.tagName.toLowerCase()
      if (!text && tag !== 'input' && tag !== 'textarea') continue
      var type = el.getAttribute('type')
      var role = el.getAttribute('role')
      var ph = el.placeholder ? String(el.placeholder).slice(0, 60) : ''
      var href = (tag === 'a' && el.href) ? String(el.href).slice(0, 120) : ''
      var base = tag + '|' + (type || '') + '|' + (role || '') + '|' + text.slice(0, 40) + '|' + ph + '|' + href
      counts[base] = (counts[base] || 0) + 1
      var key = base + '#' + counts[base]
      var ref
      if (refs[key] === undefined) { ref = next; refs[key] = ref; next++ } else { ref = refs[key] }
      window.__aeNext = next
      el.setAttribute('data-agent-ref', String(ref))
      var item = { ref: ref, tag: tag, text: text, key: key }
      if (type) item.type = type
      if (role) item.role = role
      if (ph) item.placeholder = ph
      if (el.value && type !== 'password') item.value = String(el.value).slice(0, 40)
      if (href) item.href = href
      out.push(item)
    }
    var pageText = ((document.body && document.body.innerText) || '')
      .replace(/[ \\t]+/g, ' ')
      .replace(/\\n{3,}/g, '\\n\\n')
      .slice(0, 3500)
    return { ok: true, snapshot: { url: location.href, title: document.title, elements: out, text: pageText } }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})()`

export async function snapshotPage(view: WebContentsView): Promise<PageSnapshot> {
  const res = (await view.webContents.executeJavaScript(SNIPPET, true)) as {
    ok: boolean
    snapshot?: PageSnapshot
    error?: string
  }
  if (!res || !res.ok || !res.snapshot) {
    throw new Error(res?.error || 'Could not read the page (it may be crashed or unsupported)')
  }
  return res.snapshot
}

function formatElement(el: PageSnapshot['elements'][number]): string {
  const bits = [`[${el.ref}] ${el.tag}`]
  if (el.type) bits.push(`type=${el.type}`)
  if (el.role) bits.push(`role=${el.role}`)
  if (el.text) bits.push(`"${el.text}"`)
  if (el.placeholder) bits.push(`placeholder="${el.placeholder}"`)
  if (el.value !== undefined && el.value !== '') bits.push(`value="${el.value}"`)
  if (el.href) bits.push(el.href)
  return bits.join(' ')
}

/** Compact prompt-friendly rendering of a snapshot. */
export function formatSnapshot(snap: PageSnapshot, maxElements = 120): string {
  const lines = snap.elements.slice(0, maxElements).map(formatElement)
  const text = snap.text ? `\n\nVisible page text (truncated):\n${snap.text}` : ''
  return `URL: ${snap.url}\nTitle: ${snap.title}\nInteractive elements:\n${lines.join('\n') || '(none)'}${text}`
}

/**
 * Diff two snapshots of the SAME page (same URL): only list what changed.
 * Refs are stable, so everything not listed keeps its earlier ref.
 */
export function formatSnapshotDiff(prev: PageSnapshot, curr: PageSnapshot): string {
  const prevKeys = new Set(prev.elements.map((e) => e.key))
  const currKeys = new Set(curr.elements.map((e) => e.key))
  const added = curr.elements.filter((e) => !prevKeys.has(e.key))
  const removed = prev.elements.filter((e) => !currKeys.has(e.key))

  if (!added.length && !removed.length) {
    return `URL: ${curr.url}\nTitle: ${curr.title}\nPage is UNCHANGED since the last view — all earlier [refs] are still valid.`
  }

  const lines = [`URL: ${curr.url}`, `Title: ${curr.title}`, 'Elements that changed since the last view:']
  for (const el of added) lines.push('+ ' + formatElement(el) + '  (new)')
  for (const el of removed) lines.push('- [' + el.ref + '] ' + el.tag + ' "' + (el.text || '') + '"  (gone)')
  lines.push('All other elements are unchanged — their earlier [refs] remain valid.')
  if (curr.text && curr.text.slice(0, 800) !== prev.text.slice(0, 800)) {
    lines.push('', 'Page text changed (truncated):', curr.text.slice(0, 1200))
  }
  return lines.join('\n')
}

/**
 * Build a replayable CSS locator for a tagged element (used for macro recording).
 * Prefers stable attributes over positional paths.
 */
export const LOCATOR_SNIPPET = `(() => {
  var el = document.querySelector('[data-agent-ref="__REF__"]')
  if (!el) return null
  if (el.id) return '#' + CSS.escape(el.id)
  var tag = el.tagName.toLowerCase()
  for (var i = 0; i < 3; i++) {
    var a = el.attributes[i]
    if (!a) break
    if (a.name === 'name' || a.name === 'data-testid' || a.name === 'data-test' || a.name === 'placeholder' || a.name === 'aria-label') {
      return tag + '[' + a.name + '="' + String(a.value).replace(/"/g, '\\\\"').slice(0, 60) + '"]'
    }
  }
  var parts = []
  var node = el
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
    var seg = node.tagName.toLowerCase()
    if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break }
    var parent = node.parentElement
    if (parent) {
      var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName })
      if (same.length > 1) seg += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
    }
    parts.unshift(seg)
    node = parent
  }
  var path = parts.join(' > ')
  return path.length > 220 ? null : path
})()`

export async function locatorFor(view: WebContentsView, ref: number): Promise<string | null> {
  try {
    const res = (await view.webContents.executeJavaScript(LOCATOR_SNIPPET.replace('__REF__', String(ref)), true)) as string | null
    return typeof res === 'string' && res ? res : null
  } catch {
    return null
  }
}
