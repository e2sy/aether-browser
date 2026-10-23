import { WebContentsView } from 'electron'
import type { PageSnapshot } from '../../shared/types'

/**
 * Runs inside the page: tags interactive elements with data-agent-ref and
 * returns a compact numbered menu the local model can reason over.
 * Keep it dependency-free, ES5-safe, single expression (executeJavaScript).
 */
export const SNIPPET = `(() => {
  try {
    document.querySelectorAll('[data-agent-ref]').forEach(function (e) { e.removeAttribute('data-agent-ref') })
    var sel = 'a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="combobox"],[contenteditable="true"],summary,[onclick]'
    var els = Array.prototype.slice.call(document.querySelectorAll(sel))
    var out = []
    var ref = 0
    function visible(el) {
      var r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return false
      if (r.bottom < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false
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
      el.setAttribute('data-agent-ref', String(ref))
      var item = { ref: ref, tag: tag, text: text }
      var type = el.getAttribute('type')
      var role = el.getAttribute('role')
      if (type) item.type = type
      if (role) item.role = role
      if (el.placeholder) item.placeholder = String(el.placeholder).slice(0, 60)
      if (el.value && tag !== 'password' && type !== 'password') item.value = String(el.value).slice(0, 40)
      if (tag === 'a' && el.href) item.href = String(el.href).slice(0, 120)
      out.push(item)
      ref++
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

/** Compact prompt-friendly rendering of a snapshot. */
export function formatSnapshot(snap: PageSnapshot, maxElements = 120): string {
  const lines = snap.elements.slice(0, maxElements).map((el) => {
    const bits = [`[${el.ref}] ${el.tag}`]
    if (el.type) bits.push(`type=${el.type}`)
    if (el.role) bits.push(`role=${el.role}`)
    if (el.text) bits.push(`"${el.text}"`)
    if (el.placeholder) bits.push(`placeholder="${el.placeholder}"`)
    if (el.value !== undefined && el.value !== '') bits.push(`value="${el.value}"`)
    if (el.href) bits.push(el.href)
    return bits.join(' ')
  })
  const text = snap.text ? `\n\nVisible page text (truncated):\n${snap.text}` : ''
  return `URL: ${snap.url}\nTitle: ${snap.title}\nInteractive elements:\n${lines.join('\n') || '(none)'}${text}`
}
