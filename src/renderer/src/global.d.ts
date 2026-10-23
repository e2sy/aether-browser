import type { AetherApi } from '../../preload/index'

declare global {
  interface Window {
    aether: AetherApi
  }
}

export {}
