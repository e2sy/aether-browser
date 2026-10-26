import { useEffect, useState } from 'react'
import { useApp } from '../state/store'

/**
 * Password save bar (v2.3.0) — slides up when main captured a login form
 * submission (or the user right-clicked → Save login…). The username is
 * editable (rides to main as an override on respond); "Never" blocklists
 * the host inside the vault. Prompts expire in main after 90 s.
 */
export default function SaveCredBar(): JSX.Element | null {
  const prompt = useApp((s) => s.credPrompt)
  const set = useApp((s) => s.set)
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsub = window.aether.state.onCredPrompt((raw) => {
      const p = (raw || null) as { requestId: string; host: string; url?: string; username: string } | null
      if (!p || !p.requestId) return
      setBusy(false)
      set({ credPrompt: p })
    })
    return unsub
  }, [set])

  // a new prompt resets the editable username
  useEffect(() => {
    if (prompt) setUsername(prompt.username || '')
  }, [prompt?.requestId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!prompt) return null

  const dismiss = (): void => set({ credPrompt: null })

  const respond = async (save: boolean, never: boolean): Promise<void> => {
    setBusy(true)
    try {
      await window.aether.creds.respond(prompt.requestId, save, never, username)
    } catch {
      /* prompt expired (90 s TTL) — just close the bar */
    }
    dismiss()
  }

  return (
    <div className="cred-bar" role="dialog" aria-label="Save login">
      <span className="cred-dot" />
      <div className="cred-text">
        <b>Save login for {prompt.host}?</b>
      </div>
      <input
        className="cred-user"
        value={username}
        placeholder="username or email"
        spellCheck={false}
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void respond(true, false)
        }}
      />
      <button className="cred-btn primary" disabled={busy} onClick={() => void respond(true, false)}>
        Save
      </button>
      <button className="cred-btn" disabled={busy} onClick={() => void respond(false, true)} title="Never save logins for this site">
        Never
      </button>
      <button className="cred-btn ghost" disabled={busy} onClick={() => void respond(false, false)} title="Dismiss">
        ×
      </button>
    </div>
  )
}
