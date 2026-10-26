/**
 * Reader view (v2.5.0 build 19) — Firefox-style clean-article rendering.
 *
 * Flow: the user hits F9 / context-menu "Reader view" → main grabs the live
 * page HTML via executeJavaScript, parses it with Readability (same engine as
 * the sidebar extractor), sanitizes the article to a strict whitelist, stores
 * it keyed by webContents id, then navigates that SAME webContents to
 * aether://reader. The reader page calls window.aether.reader.get() and the
 * main process hands back the stored article for that exact sender.
 *
 * Security: the reader page renders article HTML via innerHTML, so the
 * sanitizer below is the first line of defense (tag + attribute whitelist,
 * no javascript: URLs, relative URLs resolved against the article origin) and
 * the page's nonce-locked CSP is the backstop (scripts cannot run even if a
 * sanitizer bug ever slipped one through; img-src is limited to https:/data:).
 */
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import type { WebContents } from 'electron'
import { readingTimeMin } from '../shared/fmt'

const MAX_ARTICLE_CHARS = 220_000
const MAX_FETCH_BYTES = 3_000_000

export interface ReaderArticle {
  url: string
  title: string
  byline: string
  siteName: string
  excerpt: string
  /** sanitized HTML — safe for the reader page's innerHTML (whitelist below) */
  content: string
  words: number
  minutes: number
  readingListUrl: string
}

const store = new Map<number, ReaderArticle>()

/** Attributes allowed to survive sanitization. Everything else is dropped. */
const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'reversed', 'datetime', 'lang', 'dir'])

/** Tags that are outright removed WITH their subtree. */
const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT',
  'BUTTON', 'SELECT', 'TEXTAREA', 'OPTION', 'LINK', 'META', 'TEMPLATE',
  'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'SVG', 'DIALOG', 'NAV',
  'HEADER', 'FOOTER', 'ASIDE'
])

function safeUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base)
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href
    return null
  } catch {
    return null
  }
}

/** data: URLs are image-only in the reader (CSP img-src also enforces this). */
function safeImgSrc(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base)
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href
    if (u.protocol === 'data:' && /^data:image\//i.test(u.protocol)) return u.href
    return null
  } catch {
    return null
  }
}

/**
 * Sanitize a Readability article element down to the whitelist.
 * Exported for tests (bundled with jsdom/readability external).
 */
export function sanitizeArticleElement(root: Element, baseUrl: string): string {
  const doc = root.ownerDocument

  // drop dangerous containers with their subtree
  root.querySelectorAll('*').forEach((el) => {
    if (DROP_TAGS.has(el.tagName)) el.remove()
  })

  // unwrap presentation wrappers we do not style (keep their content)
  const UNWRAP = new Set(['FONT', 'CENTER', 'MAIN'])
  root.querySelectorAll('*').forEach((el) => {
    if (!UNWRAP.has(el.tagName)) return
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    el.remove()
  })

  root.querySelectorAll('*').forEach((el) => {
    // copy the list — we mutate attributes while iterating
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (!KEEP_ATTRS.has(name)) {
        el.removeAttribute(attr.name)
        continue
      }
      const val = attr.value || ''
      if (name === 'href' || name === 'src') {
        const trimmed = val.trim()
        if (/^javascript:/i.test(trimmed) || /^vbscript:/i.test(trimmed) || /^data:/i.test(trimmed)) {
          el.removeAttribute(attr.name)
          continue
        }
        if (name === 'href') {
          const abs = safeUrl(trimmed, baseUrl)
          if (!abs) {
            el.removeAttribute(attr.name)
            continue
          }
          el.setAttribute('href', abs)
        } else {
          const abs = safeImgSrc(trimmed, baseUrl)
          if (!abs) {
            el.removeAttribute(attr.name)
            continue
          }
          el.setAttribute('src', abs)
          el.setAttribute('loading', 'lazy')
          if (el.tagName === 'IMG' && !el.getAttribute('alt')) el.setAttribute('alt', '')
        }
      }
    }
  })

  // strip empty leaves that only carried attributes
  root.querySelectorAll('span, div').forEach((el) => {
    if (!el.textContent?.trim() && !el.querySelector('img')) el.remove()
  })

  void doc
  return root.innerHTML.slice(0, MAX_ARTICLE_CHARS)
}

function wordsOf(text: string): number {
  const t = (text || '').trim()
  return t ? t.split(/\s+/).length : 0
}

function articleFromHtml(html: string, url: string, fallbackTitle: string): ReaderArticle | null {
  const dom = new JSDOM(html, { url })
  dom.window.document.querySelectorAll('script,style,noscript,svg,iframe').forEach((el) => el.remove())
  const doc = dom.window.document

  let article: ReturnType<Readability['parse']> = null
  try {
    article = new Readability(doc.cloneNode(true) as Document).parse()
  } catch {
    article = null
  }
  if (!article || !article.content) return null

  const textLen = (article.textContent || '').trim()
  if (textLen.length < 160) return null // not an article (web app / search page)

  const dom2 = new JSDOM(article.content, { url })
  const contentEl = dom2.window.document.body
  if (!contentEl) return null

  const words = wordsOf(article.textContent || '')
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()

  return {
    url,
    title: article.title || fallbackTitle || host,
    byline: (article.byline || '').trim().slice(0, 120),
    siteName: (article.siteName || host).trim().slice(0, 80) || host,
    excerpt: (article.excerpt || '').trim().slice(0, 300),
    content: sanitizeArticleElement(contentEl, url),
    words,
    minutes: readingTimeMin(words),
    readingListUrl: url
  }
}

/** Capture the CURRENT DOM of `wc` into the reader store (keyed by wc id). */
export async function captureReaderArticle(wc: WebContents): Promise<ReaderArticle> {
  const url = wc.getURL()
  if (!/^https?:/i.test(url)) throw new Error('Reader view works on web pages (http/https) only')
  const html = (await wc.executeJavaScript('document.documentElement.outerHTML', true)) as string
  const article = articleFromHtml(html, url, wc.getTitle() || url)
  if (!article) throw new Error('No readable article found on this page')
  store.set(wc.id, article)
  return article
}

/** The stored article for a reader-page sender (same webContents id). */
export function getStoredArticle(wcId: number): ReaderArticle | null {
  return store.get(wcId) ?? null
}

export function forgetArticle(wcId: number): void {
  store.delete(wcId)
}

/** Fetch + parse an arbitrary article URL (reading list / "open in reader"). */
export async function fetchArticle(rawUrl: string): Promise<ReaderArticle> {
  const url = safeUrl(rawUrl, 'https://aether.invalid')
  if (!url) throw new Error('Only http(s) URLs can be opened in reader view')
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36', accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
  const type = res.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error('Not an HTML page')
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_FETCH_BYTES) throw new Error('Page too large for reader view')
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_FETCH_BYTES) throw new Error('Page too large for reader view')
  const html = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  const article = articleFromHtml(html, url, url)
  if (!article) throw new Error('No readable article found at that URL')
  return article
}
