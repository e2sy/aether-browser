import { useState } from 'react'
import type { DownloadState } from '../../../shared/types'
import { useApp } from '../state/store'

function fmtBytes(n: number): string {
  if (!n) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

function Row({ d, onDismiss }: { d: DownloadState; onDismiss: (id: string) => void }): JSX.Element {
  const active = !d.done
  const failed = Boolean(d.error)
  return (
    <div className={`dl-row ${failed ? 'failed' : ''}`}>
      <div className="dl-main">
        <div className="dl-name" title={d.path}>
          {d.filename}
        </div>
        <div className="dl-sub">
          {failed
            ? 'Failed'
            : d.cancelled
              ? 'Cancelled'
              : d.done
                ? fmtBytes(d.total) || 'Done'
                : d.percent !== null
                  ? `${d.percent}% of ${fmtBytes(d.total)}`
                  : `${fmtBytes(d.received)}…`}
        </div>
        {active && (
          <div className={`dl-bar ${d.percent === null ? 'indeterminate' : ''}`}>
            <div style={{ width: d.percent !== null ? `${d.percent}%` : '40%' }} />
          </div>
        )}
      </div>
      <div className="dl-actions">
        {active && (
          <button title="Cancel" onClick={() => void window.aether.downloads.cancel(d.id)}>
            ✕
          </button>
        )}
        {d.done && !failed && !d.cancelled && (
          <button title="Show in folder" onClick={() => void window.aether.downloads.reveal(d.path)}>
            📂
          </button>
        )}
        <button title="Dismiss" onClick={() => onDismiss(d.id)}>
          ✕
        </button>
      </div>
    </div>
  )
}

/** Bottom download shelf — progress, cancel, reveal. */
export default function DownloadBar(): JSX.Element | null {
  const downloads = useApp((s) => s.downloads)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = downloads.filter((d) => !hidden.has(d.id))
  if (!visible.length) return null
  return (
    <div className="download-bar">
      {visible.map((d) => (
        <Row
          key={d.id}
          d={d}
          onDismiss={(id) => setHidden((prev) => new Set(prev).add(id))}
        />
      ))}
    </div>
  )
}
