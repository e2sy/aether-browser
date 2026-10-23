import type { CatalogModel } from '../shared/types'

/**
 * Curated catalog shown in the in-app Model Library.
 * Disk sizes are approximate GGUF Q4 download sizes; RAM is the comfy minimum.
 * Anything NOT in this list can still be pulled by typing its exact tag
 * (ollama.com/library or hf.co GGUF repos) in the custom field.
 */
export const MODEL_CATALOG: CatalogModel[] = [
  {
    name: 'qwen3.5:9b',
    family: 'Qwen',
    params: '9B',
    disk: '≈6.1 GB',
    ram: '16 GB',
    blurb: 'Default brain — best all-round quality for chat, writing and the agent.',
    tags: ['recommended']
  },
  {
    name: 'qwen3.5:4b',
    family: 'Qwen',
    params: '4B',
    disk: '≈2.6 GB',
    ram: '8 GB',
    blurb: 'Fast and light — great default for 8 GB machines.',
    tags: ['fast', 'recommended']
  },
  {
    name: 'qwen3.5:1.7b',
    family: 'Qwen',
    params: '1.7B',
    disk: '≈1.4 GB',
    ram: '4 GB',
    blurb: 'Ultra-light model for quick chats on modest hardware.',
    tags: ['tiny']
  },
  {
    name: 'llama3.1:8b',
    family: 'Meta',
    params: '8B',
    disk: '≈4.9 GB',
    ram: '16 GB',
    blurb: "Meta's classic all-rounder with a huge ecosystem.",
    tags: []
  },
  {
    name: 'llama3.2:3b',
    family: 'Meta',
    params: '3B',
    disk: '≈2.0 GB',
    ram: '8 GB',
    blurb: 'Small Llama — snappy responses on modest machines.',
    tags: ['fast']
  },
  {
    name: 'gemma3:4b',
    family: 'Google',
    params: '4B',
    disk: '≈3.3 GB',
    ram: '8 GB',
    blurb: 'Google Gemma 3 — strong reasoning for its size.',
    tags: ['fast']
  },
  {
    name: 'phi3.5:3.8b',
    family: 'Microsoft',
    params: '3.8B',
    disk: '≈2.4 GB',
    ram: '8 GB',
    blurb: 'Microsoft Phi — punchy small model, good at summarising.',
    tags: ['fast']
  },
  {
    name: 'hermes3:8b',
    family: 'Nous',
    params: '8B',
    disk: '≈4.9 GB',
    ram: '16 GB',
    blurb: 'Tool-calling friendly — a solid alternative agent brain.',
    tags: []
  },
  {
    name: 'mistral:7b',
    family: 'Mistral',
    params: '7B',
    disk: '≈4.4 GB',
    ram: '16 GB',
    blurb: 'The original efficient European workhorse.',
    tags: []
  },
  {
    name: 'deepseek-r1:8b',
    family: 'DeepSeek',
    params: '8B',
    disk: '≈5.2 GB',
    ram: '16 GB',
    blurb: 'Reasoning-first model that shows its thinking step by step.',
    tags: ['reasoning']
  },
  {
    name: 'qwen2.5-coder:7b',
    family: 'Qwen',
    params: '7B',
    disk: '≈4.7 GB',
    ram: '16 GB',
    blurb: 'Code specialist — explains, writes and fixes code.',
    tags: ['coding']
  },
  {
    name: 'llava:7b',
    family: 'LLaVA',
    params: '7B',
    disk: '≈4.7 GB',
    ram: '16 GB',
    blurb: 'Vision model — can read images and screenshots.',
    tags: ['vision']
  },
  {
    name: 'tinyllama:1.1b',
    family: 'TinyLlama',
    params: '1.1B',
    disk: '≈0.6 GB',
    ram: '4 GB',
    blurb: 'Runs on almost anything — toaster tier.',
    tags: ['tiny']
  }
]
