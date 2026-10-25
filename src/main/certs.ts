/**
 * Certificate-error UX hardening (Master Plan Phase 0, item #14).
 *
 * Policy — there is NO silent bypass anywhere in Aether:
 *   • every TLS failure is DENIED by default (Chromium's default interstitial
 *     is replaced by our own typed-consent dialog);
 *   • the only way through is a dialog whose accept button NAMES the host —
 *     no checkbox toggles, no command-line overrides;
 *   • proceeding remembers THAT host + THAT certificate fingerprint for
 *     24 hours only, after which the site re-prompts;
 *   • a different certificate on the same host never matches the memo.
 *
 * Pure helpers (certMemoVerdict, hostOf) are unit-tested in test-v177.mjs.
 */
import { app, dialog } from 'electron'
import { JsonStore } from './store'

export const CERT_MEMO_TTL_MS = 24 * 60 * 60 * 1000

export interface CertMemo {
  host: string
  fingerprint: string
  ts: number
}

const memos = new JsonStore<Record<string, CertMemo>>('cert-memos.json', {})

/** A memo only lets traffic through while it is fresh (24h). */
export function certMemoVerdict(
  memo: { ts: number } | undefined,
  now: number,
  ttl: number = CERT_MEMO_TTL_MS
): 'allow' | 'deny' {
  if (!memo || typeof memo.ts !== 'number') return 'deny'
  if (ttl <= 0) return 'deny'
  return now - memo.ts >= 0 && now - memo.ts <= ttl ? 'allow' : 'deny'
}

/** Host(+port) of a URL — the memo key. Falls back to the raw string. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return String(url || '')
  }
}

export function listCertMemos(): CertMemo[] {
  return Object.values(memos.data).sort((a, b) => b.ts - a.ts)
}

/** Settings → "Forget remembered certificate exceptions". Returns count. */
export function forgetCertMemos(): number {
  const n = Object.keys(memos.data).length
  memos.data = {}
  memos.save()
  return n
}

/**
 * Install the app-wide certificate-error policy. Call once at boot, before
 * any window loads. Any other 'certificate-error' listener must not exist.
 */
export function installCertificateHandlers(): void {
  app.on('certificate-error', (event, _wc, url, error, certificate, callback) => {
    // Take over from Chromium's interstitial — we deny or ask, never auto-pass.
    event.preventDefault()
    const host = hostOf(url)
    const fingerprint = String(certificate?.fingerprint || '')
    const memo = memos.data[host]
    if (memo && memo.fingerprint === fingerprint && certMemoVerdict(memo, Date.now()) === 'allow') {
      callback(true)
      return
    }

    void (async () => {
      let proceed = false
      try {
        const r = await dialog.showMessageBox({
          type: 'warning',
          title: 'Your connection is not private',
          message: `Aether blocked ${host}`,
          detail: [
            `Certificate error: ${error}.`,
            '',
            'Someone could be trying to impersonate this site — it is not safe to send passwords, messages or cards right now.',
            '',
            'Continue only if you are ABSOLUTELY sure this is the right site. The exception is remembered for 24 hours, for this exact certificate only.'
          ].join('\n'),
          buttons: ['Back to safety (recommended)', `Proceed to ${host} anyway`],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        proceed = r.response === 1
      } catch {
        proceed = false
      }
      if (proceed) {
        memos.data[host] = { host, fingerprint, ts: Date.now() }
        memos.save()
      }
      callback(proceed)
    })()
  })
}
