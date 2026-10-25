# Secrets Hygiene — policy & rotation runbook

**Owner:** every contributor · **Enforced by:** `scripts/scan-secrets.mjs`
(CI step + pre-commit hook) · **Phase 0 item #18**

## The one rule

Credentials never live in the repository, a gist, an issue, or a log file —
not "temporarily", not "redacted later", not in a private branch. A token that
has been committed anywhere is burned the moment it exists, because git
history keeps it forever and forks/clones inherit it.

## What the gate catches

`scan-secrets.mjs` fails the commit/build when a file contains a
credential-shaped string:

| Kind | Example shape |
|------|---------------|
| GitHub PAT (fine-grained) | `github_pat_…` (20+ chars after the prefix) |
| GitHub classic token | `ghp_` / `gho_` / `ghs_` / `ghu_` / `ghr_` + 30 chars |
| AWS access key | `AKIA` + 16 chars |
| OpenAI-style key | `sk-` + 20 chars |
| Slack token | `xoxb-` / `xoxp-` … |
| Google API key | `AIza` + 30 chars |
| Private key blocks | `-----BEGIN … PRIVATE KEY-----` |
| Generic assignments | `api_key = "…24+ chars…"`, `password: "…"` |

Length thresholds are deliberately high so docs, regexes and example snippets
never false-positive. The scanner also skips lockfiles, build output and
binary files.

## If a secret still lands in a commit

1. **Rotate first, clean history second.** Rotate/revoke the credential at the
   provider — a purged history with a live token is still a leaked token.
2. Purge it from history (`git filter-repo --replace-text` or BFG), then
   force-push **and** notify collaborators to re-clone.
3. If it reached GitHub, treat it as public: check the Actions/audit log for
   third-party usage in the window between leak and revocation.
4. File an incident note in the issue tracker (what leaked, when, rotation
   proof) — no blame, just timeline.

## PAT rotation runbook (GitHub, for maintainers)

1. Settings → Developer settings → Personal access tokens → generate a new
   token with the **minimum scopes** needed (here: `repo` + `workflow`).
2. Store it OUTSIDE the repo: a credential manager or a chmod-600 file that
   `.git` never sees (e.g. `~/.config/aether/.ghtoken`, one directory above
   any clone). Never `echo` it into a shell that ends up in a transcript.
3. Update the consumers (CI secrets: repo Settings → Secrets → Actions →
   update `GH_PAT`; local push scripts).
4. Revoke the old token immediately after the first successful authenticated
   call with the new one — not "at the end of the week".
5. Prefer **fine-grained, expiring** tokens: repository-scoped, ≤ 90 days,
   contents read/write only. Calendar a rotation reminder.
6. If a PAT was pasted into any chat/log/ticket: rotate it as if it were
   committed — exposure surface is identical.

## Repo hygiene checklist

- [x] `scan-secrets.mjs` in CI (`build.yml`) — fails on findings
- [x] pre-commit hook available (`npm run hooks:install`)
- [x] CI pushes use a fine-grained PAT from repo Secrets, never inline
- [ ] Maintainers rotate the Actions PAT quarterly (manual, calendar-owned)
- [ ] Before every release: `npm run scan:secrets` clean + `git log -p | review`
