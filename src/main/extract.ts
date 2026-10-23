import { WebContentsView } from 'electron'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import type { PageDoc } from '../shared/types'

const MAX_CHARS = 24000

// turndown expects a DOM in Node; give it a tiny jsdom one.
let turndown: TurndownService | null = null
function getTurndown(): TurndownService | null {
  if (turndown) return turndown
  try {
    const g = globalThis as Record<string, unknown>
    if (!g.document) g.document = new JSDOM('').window.document
    turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    })
    turndown.remove(['script', 'style', 'noscript'])
    return turndown
  } catch (err) {
    console.error('[extract] turndown init failed', err)
    return null
  }
}

/**
 * Extract the readable content of a page as clean Markdown.
 * Falls back to visible text when Readability can't find an article
 * (dashboards, search results, web apps).
 */
export async function extractPage(view: WebContentsView): Promise<PageDoc | null> {
  const wc = view.webContents
  const url = wc.getURL()
  if (!/^https?:/i.test(url)) return null

  const fallbackText = (await wc
    .executeJavaScript(
      `(document.body && document.body.innerText || '').replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').slice(0, ${MAX_CHARS})`,
      true
    )
    .catch(() => '')) as string

  try {
    const html = (await wc.executeJavaScript('document.documentElement.outerHTML', true)) as string
    const dom = new JSDOM(html, { url })
    dom.window.document.querySelectorAll('script,style,noscript,svg,iframe').forEach((el) => el.remove())

    let title = dom.window.document.title || wc.getTitle() || url
    let markdown = ''
    try {
      const article = new Readability(dom.window.document.cloneNode(true) as Document).parse()
      if (article) {
        title = article.title || title
        if (article.content) {
          const td = getTurndown()
          if (td) markdown = td.turndown(article.content)
        }
        if ((!markdown || markdown.length < 200) && article.textContent) {
          markdown = article.textContent
        }
      }
    } catch {
      /* readability failed — fall through */
    }

    if (!markdown || markdown.length < 120) {
      markdown = fallbackText
    }
    if (!markdown) return null

    return { url, title, markdown: markdown.slice(0, MAX_CHARS) }
  } catch (err) {
    console.error('[extract] failed', err)
    if (fallbackText) return { url, title: wc.getTitle() || url, markdown: fallbackText }
    return null
  }
}
