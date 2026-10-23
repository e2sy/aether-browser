import type { OllamaTool } from '../ollama'
import type { ToolCallArgs } from '../../shared/types'

export const TOOLS: OllamaTool[] = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Open a URL in the current tab. Use for searches too, e.g. https://duckduckgo.com/?q=... ',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute URL, including https://' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click an interactive element by its [ref] number from the latest page state.',
      parameters: {
        type: 'object',
        properties: { ref: { type: 'number', description: 'Element ref, e.g. 12' } },
        required: ['ref']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'type',
      description: 'Type text into an input/textarea/contenteditable element by ref. Optionally submit with Enter.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'number' },
          text: { type: 'string' },
          submit: { type: 'boolean', description: 'Press Enter after typing (default false)' }
        },
        required: ['ref', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a keyboard key on the focused element, e.g. Enter, Escape, Tab, ArrowDown.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page up or down to reveal more elements.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'] },
          amount: { type: 'number', description: 'Pixels (default 600)' }
        },
        required: ['direction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'go_back',
      description: 'Navigate back in this tab\u2019s history.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_page',
      description: 'Read the page\u2019s main readable content as clean text (for long articles).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_text',
      description: 'Find a text query in the page; returns the number of matches and the first match context.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: 'List all open tabs (id, title, URL) for context. The agent acts only in the current tab.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Save a PNG screenshot of the current page to disk; returns the file path and dimensions. Prefer read_page for content \u2014 you cannot view images.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Ask the user a short clarifying question and wait for their typed answer. Use instead of guessing when the task is ambiguous or a required choice cannot be inferred from the page.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string', description: 'One short, specific question' } },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Finish the task and report the result to the user.',
      parameters: {
        type: 'object',
        properties: { answer: { type: 'string', description: 'Concise final summary for the user' } },
        required: ['answer']
      }
    }
  }
]

/** Tools that modify page state — gated by the confirm-each-action setting. */
export const MUTATING_TOOLS = new Set(['navigate', 'click', 'type', 'press_key'])

export interface ExecContext {
  navigate: (args: ToolCallArgs) => Promise<string>
  click: (args: ToolCallArgs) => Promise<string>
  typeText: (args: ToolCallArgs) => Promise<string>
  pressKey: (args: ToolCallArgs) => Promise<string>
  scrollPage: (args: ToolCallArgs) => Promise<string>
  goBack: () => Promise<string>
  readPage: () => Promise<string>
  findText: (args: ToolCallArgs) => Promise<string>
  listTabs: () => Promise<string>
  screenshot: () => Promise<string>
  askUser: (args: ToolCallArgs) => Promise<string>
}

export async function executeTool(name: string, args: ToolCallArgs, ctx: ExecContext): Promise<string> {
  switch (name) {
    case 'navigate':
      return ctx.navigate({ __url: String(args.url || '') })
    case 'click':
      return ctx.click(args)
    case 'type':
      return ctx.typeText(args)
    case 'press_key':
      return ctx.pressKey(args)
    case 'scroll':
      return ctx.scrollPage(args)
    case 'go_back':
      return ctx.goBack()
    case 'read_page':
      return ctx.readPage()
    case 'find_text':
      return ctx.findText(args)
    case 'list_tabs':
      return ctx.listTabs()
    case 'screenshot':
      return ctx.screenshot()
    case 'ask_user':
      return ctx.askUser(args)
    default:
      return `Unknown tool: ${name}`
  }
}
