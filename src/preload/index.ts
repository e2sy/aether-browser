import { contextBridge } from 'electron'
import { api } from './api'

/**
 * Tab-view preload (web pages + aether:// internal pages).
 *
 * Runs with sandbox:true — Electron only allows require("electron") here; no
 * node builtins, no node_modules. This file therefore imports NOTHING else:
 * everything (including electron-chrome-extensions) lives in preload/ui.ts,
 * which is loaded only by the trusted chrome UI window (sandbox:false).
 */
contextBridge.exposeInMainWorld('aether', api)

export type { AetherApi } from './api'
