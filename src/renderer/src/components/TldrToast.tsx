import { useEffect, useState } from 'react'
import { useApp } from '../state/store'

/**
 * TL;DR toast (Master Plan Phase 4, item #72) — the local model's 3-bullet
 * summary of pages whose hosts the user opted in. Auto-dismisses; the user
 * can close it sooner.
 */
interface TldrPayload {
  tabId: number
  title: string
  summary: string
}

export default function TldrToast(): JSX.Element | null {
  const activeId = useApp((s) => s.activeId)
  const [toast, setToast] = useState<TldrPayload | null>(null)

  useEffect(() => {
    const unsub = window.aether.ai2.onTLDR((raw) => {
      const t = raw as TldrPayload | null
      if (!t || typeof t.summary !== 'string' || !t.summary) return
      setToast({ tabId: Number(t.tabId), title: String(t.title || 'This page'), summary: t.summary })
      setTimeout(() => {
        setToast((cur) => (cur && cur.tabId === Number(t.tabId) ? null : cur))
      }, 20000)
    })
    return () => {
      try {
        unsub()
      } catch {
        /* noop */
      }
    }
  }, [])

  // only show while the summarized tab is still the active one
  if (!toast || toast.tabId !== activeId) return null
  return (
    <div className="tldr-toast" role="status">
      <div className="tldr-head">
        <span className="tldr-badge">TL;DR</span>
        <span className="tldr-title">{toast.title}</span>
        <button className="tldr-close" onClick={() => setToast(null)} title="Dismiss">
          ×
        </button>
      </div>
      <div className="tldr-body">
        {toast.summary.split('\n').map((line, i) =>
          line.trim() ? (
            <div key={i} className="tldr-line">
              {line.replace(/^-\s*/, '')}
            </div>
          ) : null
        )}
      </div>
    </div>
  )
}
