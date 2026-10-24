import type { AetherApi } from '../../preload/api'

declare global {
  interface Window {
    aether: AetherApi
  }
  namespace JSX {
    interface IntrinsicElements {
      /** custom element injected by electron-chrome-extensions */
      'browser-action-list': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

export {}
