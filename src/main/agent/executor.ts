import { WebContentsView, WebContents, app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chatOnce, friendlyError, pickDefaultModel, OllamaMessage } from '../ollama'
import { settings } from '../store'
import { extractPage } from '../extract'
import { AGENT_SYSTEM } from './prompts'
import { TOOLS, MUTATING_TOOLS, executeTool, ExecContext } from './tools'
import { snapshotPage, formatSnapshot, formatSnapshotDiff, locatorFor } from './serializer'
import { markRun } from '../macros'
import type { TabManager } from '../tabs'
import type { AgentEventType, Macro, MacroStep, PageSnapshot, ToolCallArgs } from '../../shared/types'

const MAX_STEPS = 12
const CONFIRM_TIMEOUT_MS = 120_000
const ANSWER_TIMEOUT_MS = 180_000
/** v2.9.0 — hard ceiling for ONE model call inside the agent loop. */
const AGENT_CALL_TIMEOUT_MS = 300_000

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

  /** Wait for an in-flight navigation to finish, then a small settle delay. */
  private async waitSettle(wc: WebContents): Promise<void> {
    if (wc.isLoading()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 10_000)
        const onDone = (): void => done()
        function done(): void {
          clearTimeout(timer)
          wc.removeListener('did-stop-loading', onDone)
          resolve()
        }
        wc.once('did-stop-loading', onDone)
      })
    }
    await new Promise((r) => setTimeout(r, 450))
  }

  /**
   * One model turn with a single retry on transient failures (model load, hiccup).
   * v2.9.0 — each call is also race-limited (5 min): a wedged Ollama used to
   * leave the agent looping on a step forever with no error surfaced.
   */
  private async chatOnceRetry(
    model: string,
    messages: OllamaMessage[],
    signal: AbortSignal
  ): Promise<OllamaMessage> {
    const callOnce = (): Promise<OllamaMessage> => {
      const inner = new AbortController()
      const onOuter = (): void => inner.abort()
      signal.addEventListener('abort', onOuter, { once: true })
      const timer = setTimeout(() => inner.abort(), AGENT_CALL_TIMEOUT_MS)
      return chatOnce(model, messages, TOOLS, inner.signal)
        .then((r) => r.message)
        .finally(() => {
          clearTimeout(timer)
          signal.removeEventListener('abort', onOuter)
        })
    }
    try {
      return await callOnce()
    } catch (err) {
      if (signal.aborted) throw err
      await new Promise((r) => setTimeout(r, 1200))
      return await callOnce()
    }
  }

  async run(
    task: string,
    view: WebContentsView,
    tm: TabManager,
    sender: WebContents,
    opts: { record?: boolean } = {}
  ): Promise<void> {
    const requestId = randomUUID().replace(/-/g, '').slice(0, 10)
    const ctrl = new AbortController()
    this.aborts.set(requestId, ctrl)
    const emit = (type: AgentEventType, extra: Record<string, unknown> = {}): void => {
      if (!sender.isDestroyed()) sender.send('agent:event', { requestId, type, ...extra })
    }
    const wc = view.webContents

    try {
      const model = settings.data.model || (await pickDefaultModel())
      if (!model) {
        emit('error', {
          data: 'No local model available for the agent (the cloud fallback only covers chat & AI search). Install Ollama and pull a model.'
        })
        return
      }
      emit('start', { data: { model, record: Boolean(opts.record), maxSteps: MAX_STEPS } })

      const snap = await snapshotPage(view)
      const messages: OllamaMessage[] = [
        { role: 'system', content: AGENT_SYSTEM },
        { role: 'user', content: `Task: ${task}\n\nCurrent page state:\n${formatSnapshot(snap)}` }
      ]
      let prev: PageSnapshot = snap
      let consecProse = 0
      let lastTitle = snap.title
      const recorded: MacroStep[] = []

      for (let step = 1; step <= MAX_STEPS; step++) {
        if (ctrl.signal.aborted) break
        const message = await this.chatOnceRetry(model, messages, ctrl.signal)
        messages.push(message)
        const calls = message.tool_calls || []

        // No tool call: nudge once, then accept the prose as the final answer.
        if (!calls.length) {
          const text = (message.content || '').trim()
          if (consecProse >= 1 || step === MAX_STEPS) {
            emit('done', { data: { answer: text || 'Done.' } })
            return
          }
          consecProse++
          if (text) emit('step', { tool: 'thinking', args: {}, data: { result: text.slice(0, 160), step, maxSteps: MAX_STEPS } })
          messages.push({
            role: 'user',
            content:
              'Respond with ONE tool call (navigate/click/type/scroll/read_page/…), or call done with your final answer. Plain prose without an action is not accepted.'
          })
          continue
        }
        consecProse = 0

        let mutated = false
        for (const call of calls) {
          const name = call.function?.name || ''
          const args = (call.function?.arguments || {}) as ToolCallArgs

          if (name === 'done') {
            emit('done', { data: { answer: String(args.answer || 'Done.'), steps: opts.record ? recorded : undefined } })
            return
          }

          let result: string
          if (MUTATING_TOOLS.has(name) && settings.data.confirmAgentActions) {
            emit('confirm', { tool: name, args })
            const ok = await this.waitConfirm(requestId)
            if (!ok) {
              result = 'The user DENIED this action. Do not retry it; ask the user how to proceed or finish with done.'
            } else {
              result = await executeTool(name, args, this.buildCtx(view, tm, emit, requestId, ctrl.signal))
            }
          } else {
            result = await executeTool(name, args, this.buildCtx(view, tm, emit, requestId, ctrl.signal))
          }

          // macro recording: capture successful mutating steps with a replayable locator
          if (opts.record && result.startsWith('OK') && MUTATING_TOOLS.has(name)) {
            const recArgs: ToolCallArgs = { ...args }
            if ((name === 'click' || name === 'type') && Number.isFinite(Number(args.ref))) {
              const loc = await locatorFor(view, Number(args.ref))
              if (loc) recArgs.__locator = loc
            }
            recorded.push({ tool: name, args: recArgs })
          }

          if (result.startsWith('OK') && MUTATING_TOOLS.has(name)) mutated = true
          messages.push({ role: 'tool', content: result.slice(0, 4000), tool_name: name })
          emit('step', { tool: name, args, data: { result: result.slice(0, 300), step, maxSteps: MAX_STEPS } })
        }

        if (mutated) {
          await this.waitSettle(wc)
          const fresh = await snapshotPage(view)
          lastTitle = fresh.title
          const sameUrl = fresh.url === prev.url
          messages.push({
            role: 'user',
            content: sameUrl ? `Updated page state (diff):\n${formatSnapshotDiff(prev, fresh)}` : `Updated page state:\n${formatSnapshot(fresh)}`
          })
          prev = fresh
        }
      }

      const doneSteps = opts.record ? recorded : undefined
      emit('done', {
        data: {
          answer: `Stopped after ${MAX_STEPS} steps (safety limit). Last page seen: "${lastTitle}". You can refine the task and run again.`,
          steps: doneSteps
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

  /** Replay a saved macro: same tools, no model, same confirmation gates. */
  async runMacro(macro: Macro, view: WebContentsView, tm: TabManager, sender: WebContents): Promise<void> {
    const requestId = randomUUID().replace(/-/g, '').slice(0, 10)
    const ctrl = new AbortController()
    this.aborts.set(requestId, ctrl)
    const emit = (type: AgentEventType, extra: Record<string, unknown> = {}): void => {
      if (!sender.isDestroyed()) sender.send('agent:event', { requestId, type, ...extra })
    }

    try {
      emit('start', { data: { macro: macro.name, total: macro.steps.length } })
      const ctx = this.buildCtx(view, tm, emit, requestId, ctrl.signal)

      for (let i = 0; i < macro.steps.length; i++) {
        if (ctrl.signal.aborted) break
        const st = macro.steps[i]
        let result: string
        if (MUTATING_TOOLS.has(st.tool) && settings.data.confirmAgentActions) {
          emit('confirm', { tool: st.tool, args: st.args })
          const ok = await this.waitConfirm(requestId)
          if (!ok) {
            result = 'SKIP: denied by user'
          } else {
            result = await executeTool(st.tool, st.args, ctx)
          }
        } else {
          result = await executeTool(st.tool, st.args, ctx)
        }

        emit('step', {
          tool: st.tool,
          args: st.args,
          data: { result: result.slice(0, 200), step: i + 1, maxSteps: macro.steps.length, macro: macro.name }
        })

        if (result.startsWith('SKIP')) continue
        if (result.startsWith('FAILED') || result.startsWith('Unknown tool')) {
          emit('done', { data: { answer: `Macro stopped at step ${i + 1} (${st.tool}): ${result}` } })
          return
        }
        if (MUTATING_TOOLS.has(st.tool)) await this.waitSettle(view.webContents)
      }

      markRun(macro.id)
      emit('done', { data: { answer: `Macro "${macro.name}" finished: ${macro.steps.length} step(s) replayed.` } })
    } catch (err) {
      if (ctrl.signal.aborted) emit('cancelled', {})
      else emit('error', { data: friendlyError(err) })
    } finally {
      this.aborts.delete(requestId)
      this.confirms.delete(requestId)
      this.asks.delete(requestId)
    }
  }

  /** Build the tool execution context used by both agent runs and macro replays. */
  private buildCtx(
    view: WebContentsView,
    tm: TabManager,
    emit: (type: AgentEventType, extra?: Record<string, unknown>) => void,
    requestId: string,
    signal: AbortSignal
  ): ExecContext {
    const wc = view.webContents
    const js = async (code: string): Promise<unknown> => wc.executeJavaScript(code, true)

    // locator-aware selector: macro replays use the recorded CSS path, live runs use data-agent-ref
    const selFor = (a: ToolCallArgs): string => {
      const loc = typeof a.__locator === 'string' && a.__locator ? a.__locator : null
      if (loc) return `document.querySelector(${JSON.stringify(loc)})`
      const ref = Number(a.ref)
      return `document.querySelector('[data-agent-ref="${ref}"]')`
    }

    return {
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
        const pos = (await js(
          `(() => { const el = ${selFor(a)}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`
        )) as { x: number; y: number } | null
        if (!pos) {
          return 'FAILED: element not found — the page changed since the last snapshot. Re-observe and pick a valid ref.'
        }
        wc.sendInputEvent({ type: 'mouseDown', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
        return `OK: clicked element`
      },
      typeText: async (a: ToolCallArgs) => {
        const text = String(a.text ?? '')
        const textJson = JSON.stringify(text)
        const res = (await js(
          `(() => {
            const el = ${selFor(a)}
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
        return `OK: typed ${text.length} chars`
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
  }
}

export const agentRunner = new AgentRunner()
