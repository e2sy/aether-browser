import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { pullModel, friendlyError } from './ollama'
import { settings } from './store'
import type { PullProgress } from '../shared/types'

/**
 * Tracks in-flight model pulls, broadcasts progress to the UI and
 * keeps going even if the sidebar is closed — downloads run in the main process.
 */

interface PullJob {
  pullId: string
  name: string
  ctrl: AbortController
  startedAt: number
  last: PullProgress
}

const pulls = new Map<string, PullJob>()

/** How long finished jobs stay queryable so the UI can show the outcome. */
const FINISHED_TTL_MS = 8000

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload)
    } catch {
      /* window gone */
    }
  }
}

function sendProgress(job: PullJob, patch: Partial<PullProgress>): void {
  job.last = { ...job.last, ...patch }
  broadcast('models:pull-progress', job.last)
}

export function startPull(name: string): { pullId: string } {
  const existing = [...pulls.values()].find((j) => j.name === name)
  if (existing) return { pullId: existing.pullId } // already pulling this model

  const pullId = randomUUID().replace(/-/g, '').slice(0, 10)
  const job: PullJob = {
    pullId,
    name,
    ctrl: new AbortController(),
    startedAt: Date.now(),
    last: { pullId, name, status: 'starting…', total: 0, completed: 0, percent: null, done: false }
  }
  pulls.set(pullId, job)
  void runPull(job)
  return { pullId }
}

async function runPull(job: PullJob): Promise<void> {
  console.log('[models] pull started:', job.name)
  try {
    await pullModel(
      job.name,
      (evt) => {
        sendProgress(job, { status: evt.status, total: evt.total, completed: evt.completed, percent: evt.percent })
      },
      job.ctrl.signal
    )
    sendProgress(job, { status: 'success', percent: 100, done: true })
    // first model ever? make it the default brain immediately
    if (!settings.data.model) {
      settings.data.model = job.name
      settings.save()
    }
    broadcast('models:changed', { name: job.name })
    console.log('[models] pull finished:', job.name)
  } catch (err) {
    if (job.ctrl.signal.aborted) {
      sendProgress(job, { status: 'cancelled', done: true, cancelled: true })
      console.log('[models] pull cancelled:', job.name)
    } else {
      const msg = friendlyError(err)
      sendProgress(job, { status: 'error', done: true, error: msg })
      console.error('[models] pull failed:', job.name, msg)
    }
  } finally {
    setTimeout(() => pulls.delete(job.pullId), FINISHED_TTL_MS)
  }
}

export function cancelPull(pullId: string): boolean {
  const job = pulls.get(pullId)
  if (!job || job.last.done) return false
  job.ctrl.abort()
  return true
}

export function activePulls(): PullProgress[] {
  return [...pulls.values()].map((j) => j.last)
}

export function isPulling(name: string): boolean {
  return [...pulls.values()].some((j) => j.name === name && !j.last.done)
}
