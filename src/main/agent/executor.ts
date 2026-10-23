import { WebContentsView, WebContents, app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chatOnce, friendlyError, pickDefaultModel, OllamaMessage } from '../ollama'
import { settings } from '../store'
import { extractPage } from '../extract'
import { AGENT_SYSTEM } from './prompts'
import { TOOLS, MUTATING_TOOLS, executeTool, ExecContext } from './tools'
import { snapshotPage, formatSnapshot } from './serializer'
import type { TabManager } from '../tabs'
import type { AgentEventType, ToolCallArgs } from '../../shared/types'

const MAX_STEPS = 12
const CONFIRM_TIMEOUT_MS = 120_000
const ANSWER_TIMEOUT_MS = 180_000

export class AgentRunner {
  private aborts = new Map<string, AbortController>()
  private confirms = new Map<string, (ok: boolean) => void>()
  private asks = new Map<string, (answer: string | null) => void>()

  cancel(requestId: string): void {
    this.aborts.get(requestId)?.abort()
    this.confirms.get(requestId)?.(false)
    this.asks.get(requestId)?.(null)
  }

  respondConfirm(requestId: string, approved: boolean): void {
    this.confirms.get(requestId)?.(approved)
  }

  answer(requestId: string, text: string): void {
    const t = text.trim()
    this.asks.get(requestId)?.(t ? t.slice(0, 500) : null)
  }

  private waitConfirm(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.confirms.delete(requestId)
        resolve(false)
      }, CONFIRM_TIMEOUT_MS)
      this.confirms.set(requestId, (ok: boolean) => {
        clearTimeout(timer)
        this.confirms.delete(requestId)
        resolve(ok)
      })
    })
  }

  private waitAnswer(requestId: string): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.asks.delete(requestId)
        resolve(null)
      }, ANSWER_TIMEOUT_MS)
      this.asks.set(requestId, (answer: string | null) => {
        clearTimeout(timer)
        this.asks.delete(requestId)
        resolve(answer)
      })
    })
  }

  async run(task: string, view: WebContentsView, tm: TabManager, sender: WebContents): Promise<void> {
    const requestId = randomUUID().replace(/-/g, '').slice(0, 10)
    const ctrl = new AbortController()
    this.aborts.set(requestId, ctrl)
    const emit = (type: AgentEventType, extra: Record<string, unknown> = {}): void => {
      if (!sender.isDestroyed()) sender.send('agent:event', { requestId, type, ...extra })
    }

    try {
      const model = settings.data.model || (await pickDefaultModel())
      if (!model) {
        emit('error', {
          data: 'No Ollama model available. Install Ollama (https://ollama.com) and run:  ollama pull qwen3.5:9b'
        })
        return
      }
      emit('start', { data: { model } })

      const snap = await snapshotPage(view)
      const messages: OllamaMessage[] = [
        { role: 'system', content: AGENT_SYSTEM },
        { role: 'user', content: `Task: ${task}\n\nCurrent page state:\n${formatSnapshot(snap)}` }
      ]
      let lastTitle = snap.title

      for (let step = 1; step <= MAX_STEPS; step++) {
        const { message } = await chatOnce(model, messages, TOOLS, ctrl.signal)
        messages.push(message)
        const calls = message.tool_calls || []

        if (!calls.length) {
          emit('done', { data: { answer: message.content || 'Done.' } })
          return
        }

        let mutated = false
        for (const call of calls) {
          const name = call.function?.name || ''
          const args = (call.function?.arguments || {}) as ToolCallArgs

          if (name === 'done') {
            emit('done', { data: { answer: String(args.answer || 'Done.') } })
            return
          }

          let result: string
          if (MUTATING_TOOLS.has(name) && settings.data.confirmAgentActions) {
            emit('confirm', { tool: name, args })
            const ok = await this.waitConfirm(requestId)
            if (!ok) {
              result = 'The user DENIED this action. Do not retry it; ask the user how to proceed or finish with done.'
            } else {
              result = await this.exec(name, args, view, tm, emit, requestId, ctrl.signal)
            }
          } else {
            result = await this.exec(name, args, view, tm, emit, requestId, ctrl.signal)
          }

          if (result.startsWith('OK') && MUTATING_TOOLS.has(name)) mutated = true
          messages.push({ role: 'tool', content: result.slice(0, 4000), tool_name: name })
          emit('step', { tool: name, args, data: { result: result.slice(0, 300) } })
        }

        if (mutated) {
          await new Promise((r) => setTimeout(r, 800)) // let the page settle
          const fresh = await snapshotPage(view)
          lastTitle = fresh.title
          messages.push({ role: 'user', content: `Updated page state:\n${formatSnapshot(fresh)}` })
        }
      }

      emit('done', {
        data: {
          answer: `Stopped after ${MAX_STEPS} steps (safety limit). Last page seen: "${lastTitle}". You can refine the task and run again.`
        }
      })
    } catch (err) {
      if (ctrl.signal.aborted) emit('cancelled', {})
      else emit('error', { data: friendlyError(err) })
    } finally {
      this.aborts.delete(requestId)
      this.confirms.delete(requestId)
      this.asks.delete(requestId)
    }
  }

  private async exec(
    name: string,
    args: ToolCallArgs,
    view: WebContentsView,
    tm: TabManager,
    emit: (type: AgentEventType, extra?: Record<string, unknown>) => void,
    requestId: string,
    signal: AbortSignal
  ): Promise<string> {
    const wc = view.webContents
    const js = async (code: string): Promise<unknown> => wc.executeJavaScript(code, true)

    const ctx: ExecContext = {
      navigate: async (a: ToolCallArgs) => {
        const url = String(a.__url || '')
        if (!/^https?:\/\//i.test(url)) return `FAILED: only http(s) URLs are allowed, got: ${url}`
        try {
          await wc.loadURL(url)
          return `OK: navigated to ${url}`
        } catch (err) {
          if (signal.aborted) throw err
          return `FAILED to load ${url}: ${err instanceof Error ? err.message : String(err)}`
        }
      },
      click: async (a: ToolCallArgs) => {
        const ref = Number(a.ref)
        if (!Number.isFinite(ref)) return 'FAILED: ref must be a number'
        const pos = (await js(
          `(() => { const el = document.querySelector('[data-agent-ref="${ref}"]'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`
        )) as { x: number; y: number } | null
        if (!pos) {
          return 'FAILED: element not found — the page changed since the last snapshot. Re-observe and pick a valid ref.'
        }
        wc.sendInputEvent({ type: 'mouseDown', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
        return `OK: clicked element [${ref}]`
      },
      typeText: async (a: ToolCallArgs) => {
        const ref = Number(a.ref)
        const text = String(a.text ?? '')
        if (!Number.isFinite(ref)) return 'FAILED: ref must be a number'
        const textJson = JSON.stringify(text)
        const res = (await js(
          `(() => {
            const el = document.querySelector('[data-agent-ref="${ref}"]')
            if (!el) return null
            el.focus()
            const tag = el.tagName.toLowerCase()
            if (el.isContentEditable) {
              el.textContent = ${textJson}
              el.dispatchEvent(new InputEvent('input', { bubbles: true }))
              return { ok: true }
            }
            if (tag !== 'input' && tag !== 'textarea') return { notEditable: true }
            const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set
            if (setter) setter.call(el, ${textJson})
            else el.value = ${textJson}
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
            return { ok: true }
          })()`
        )) as { ok?: boolean; notEditable?: boolean } | null
        if (!res) return 'FAILED: element not found — page changed. Re-observe.'
        if (res.notEditable) return 'FAILED: that element is not a text field. Pick an input/textarea/contenteditable ref.'
        if (a.submit) {
          await new Promise((r) => setTimeout(r, 120))
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
          return `OK: typed ${text.length} chars and pressed Enter`
        }
        return `OK: typed ${text.length} chars into [${ref}]`
      },
      pressKey: async (a: ToolCallArgs) => {
        const key = String(a.key || '').slice(0, 20)
        wc.sendInputEvent({ type: 'keyDown', keyCode: key })
        wc.sendInputEvent({ type: 'keyUp', keyCode: key })
        return `OK: pressed ${key}`
      },
      scrollPage: async (a: ToolCallArgs) => {
        const dir = a.direction === 'up' ? -1 : 1
        const amount = Number(a.amount) || 600
        await js(`window.scrollBy(0, ${dir * amount}); true`)
        return `OK: scrolled ${dir > 0 ? 'down' : 'up'} by ${amount}px`
      },
      goBack: async () => {
        if (wc.navigationHistory.canGoBack()) {
          wc.navigationHistory.goBack()
          return 'OK: went back'
        }
        return 'FAILED: no previous page in history'
      },
      readPage: async () => {
        const doc = await extractPage(view)
        if (!doc) return 'FAILED: this page has no extractable content (it may be an internal page or a web app).'
        return `OK: page content ("${doc.title}"):\n${doc.markdown.slice(0, 6000)}`
      },
      findText: async (a: ToolCallArgs) => {
        const query = String(a.query || '')
        if (!query) return 'FAILED: empty query'
        try {
          wc.stopFindInPage('clearSelection')
          const res = await new Promise<Electron.FoundInPageResult>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('findInPage timed out')), 5000)
            wc.once('found-in-page', (_e, r) => {
              clearTimeout(timer)
              resolve(r)
            })
            wc.findInPage(query)
          })
          return `OK: found ${res.matches} match(es) for "${query}". Current match: ${res.activeMatchOrdinal}.`
        } catch (err) {
          return `FAILED: ${err instanceof Error ? err.message : String(err)}`
        }
      },
      listTabs: async () => {
        const rows = tm
          .listIds()
          .map((id) => {
            const t = tm.get(id)
            const mark = id === tm.activeId ? ' (current)' : ''
            return t ? `#${id}${mark} ${t.title} — ${t.url}` : ''
          })
          .filter(Boolean)
        return rows.length ? `OK: open tabs:\n${rows.join('\n')}` : 'OK: no other tabs open'
      },
      screenshot: async () => {
        try {
          const image = await wc.capturePage()
          const dir = path.join(app.getPath('userData'), 'screenshots')
          fs.mkdirSync(dir, { recursive: true })
          const file = path.join(dir, `agent-${Date.now()}.png`)
          fs.writeFileSync(file, image.toPNG())
          const size = image.getSize()
          return `OK: screenshot saved to ${file} (${size.width}x${size.height})`
        } catch (err) {
          return `FAILED: ${err instanceof Error ? err.message : String(err)}`
        }
      },
      askUser: async (a: ToolCallArgs) => {
        const question = String(a.question || '').trim().slice(0, 500)
        if (!question) return 'FAILED: empty question'
        emit('ask_user', { data: question })
        const answer = await this.waitAnswer(requestId)
        if (answer === null) {
          return 'No user answer (timeout or skipped). Proceed with your best judgment, or call done and explain what you need.'
        }
        return `OK: the user replied: "${answer}"`
      }
    }

    return executeTool(name, args, ctx)
  }
}

export const agentRunner = new AgentRunner()
