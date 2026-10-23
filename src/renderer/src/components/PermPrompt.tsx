import { useEffect, useState } from 'react'

interface PermRequest {
  requestId: string
  origin: string
  permission: string
}

const LABELS: Record<string, string> = {
  media: 'use your camera & microphone',
  geolocation: 'see your location',
  notifications: 'send you notifications',
  midi: 'access your MIDI devices',
  'speaker-selection': 'pick an audio output',
  'display-capture': 'capture your screen'
}

/** Chrome-style permission bubble: "example.com wants to …  [Block] [Allow]" */
export default function PermPrompt(): JSX.Element | null {
  const [req, setReq] = useState<PermRequest | null>(null)
  const [remember, setRemember] = useState(true)

  useEffect(() => {
    return window.aether.perms.onRequest((raw) => {
      const r = raw as PermRequest
      if (r && r.requestId) setReq(r)
    })
  }, [])

  const answer = (allow: boolean): void => {
    if (!req) return
    void window.aether.perms.respond(req.requestId, allow, remember)
    setReq(null)
    setRemember(true)
  }

  if (!req) return null

  let host = req.origin
  try {
    host = new URL(req.origin).hostname
  } catch {
    /* keep raw */
  }

  return (
    <div className="perm-prompt">
      <div className="perm-text">
        <b>{host}</b> wants to {LABELS[req.permission] || req.permission}
      </div>
      <label className="perm-remember">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember this choice for {host}
      </label>
      <div className="perm-actions">
        <button className="deny" onClick={() => answer(false)}>
          Block
        </button>
        <button className="allow" onClick={() => answer(true)}>
          Allow
        </button>
      </div>
    </div>
  )
}
