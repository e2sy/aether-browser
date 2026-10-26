/**
 * Task-manager metrics mapping (pure — build 19).
 *
 * Electron's `app.getAppMetrics()` gives per-process samples; the task-manager
 * page needs human rows: which process is a TAB (with title/url + kill target),
 * which is the interface, GPU, utility…, plus CPU% smoothed against the
 * previous sample (Electron reports a rolling cumulative-ish percent that
 * spikes oddly on poll boundaries — the Chrome-style number is the delta
 * between two of OUR polls, normalized by elapsed wall time).
 */

export interface TaskTabRef {
  winId: number
  tabId: number
  title: string
  url: string
  /** webContents.getOSProcessId() — matches AppMetrics.pid */
  pid: number | undefined
  /** marks the chrome-UI renderer of the window (not killable from here) */
  isInterface?: boolean
}

export interface PrevSample {
  /** pid → { percentCPUUsage snapshot, wall-clock ms } */
  [pid: number]: { cpu: number; at: number }
}

export interface TaskRow {
  pid: number
  kind: 'browser' | 'gpu' | 'utility' | 'tab' | 'interface' | 'other'
  label: string
  sublabel: string
  cpuPct: number
  /** working set in bytes */
  memBytes: number
  /** present ONLY for tab rows — the task-manager page may close this tab */
  kill?: { winId: number; tabId: number }
}

export interface TaskSnapshot {
  rows: TaskRow[]
  totalMemBytes: number
  /** pass back into the next call so CPU stays smoothed across polls */
  next: PrevSample
}

interface ElectronMetric {
  pid: number
  type: string
  service?: string
  cpu?: { percentCPUUsage?: number }
  memory?: { workingSetSize?: number }
}

const KIND_LABEL: Record<string, string> = {
  Browser: 'Aether',
  GPU: 'GPU process',
  Utility: 'Utility',
  Zygote: 'Zygote',
  'Sandbox Helper': 'Sandbox helper',
  Network: 'Network service',
  Storage: 'Storage service'
}

function smooth(prevCpu: number | undefined, prevAt: number | undefined, curCpu: number, nowMs: number): number {
  if (prevCpu === undefined || !prevAt || nowMs <= prevAt) return 0
  const elapsed = (nowMs - prevAt) / 1000
  if (elapsed <= 0) return 0
  return Math.max(0, (curCpu - prevCpu) / elapsed)
}

/**
 * Build display rows. `metrics` is `app.getAppMetrics()` output (or a mock in
 * tests), `tabs` the live tab refs gathered from all windows.
 */
export function mapTaskMetrics(
  metrics: ElectronMetric[],
  tabs: TaskTabRef[],
  prev: PrevSample = {},
  nowMs: number = Date.now()
): TaskSnapshot {
  const byPid = new Map<number, TaskTabRef>()
  for (const t of tabs) {
    if (typeof t.pid === 'number' && Number.isFinite(t.pid)) byPid.set(t.pid, t)
  }

  const rows: TaskRow[] = []
  const next: PrevSample = {}

  for (const m of metrics) {
    if (!m || typeof m.pid !== 'number') continue
    const curCpu = Number(m.cpu?.percentCPUUsage) || 0
    const memKb = Number(m.memory?.workingSetSize) || 0
    const memBytes = memKb * 1024
    const before = prev[m.pid]
    const cpuPct = smooth(before?.cpu, before?.at, curCpu, nowMs)
    next[m.pid] = { cpu: curCpu, at: nowMs }

    const tab = byPid.get(m.pid)
    if (tab) {
      rows.push({
        pid: m.pid,
        kind: tab.isInterface ? 'interface' : 'tab',
        label: tab.isInterface ? 'Aether interface' : tab.title || 'Untitled',
        sublabel: tab.isInterface ? 'Browser UI' : tab.url,
        cpuPct,
        memBytes,
        ...(tab.isInterface ? {} : { kill: { winId: tab.winId, tabId: tab.tabId } })
      })
      continue
    }

    const kind: TaskRow['kind'] =
      m.type === 'Browser'
        ? 'browser'
        : m.type === 'GPU'
          ? 'gpu'
          : m.type === 'Utility'
            ? 'utility'
            : 'other'
    rows.push({
      pid: m.pid,
      kind,
      label: KIND_LABEL[m.type] || m.type || 'Process',
      sublabel: m.type === 'Utility' ? m.service || '' : '',
      cpuPct,
      memBytes
    })
  }

  // dead pids fall out of `next` so the map cannot grow forever
  const live = new Set(metrics.map((m) => m?.pid).filter((p) => typeof p === 'number'))
  for (const pid of Object.keys(prev).map(Number)) {
    if (!live.has(pid)) delete next[pid]
  }

  rows.sort((a, b) => b.memBytes - a.memBytes)
  const totalMemBytes = rows.reduce((acc, r) => acc + r.memBytes, 0)
  return { rows, totalMemBytes, next }
}
