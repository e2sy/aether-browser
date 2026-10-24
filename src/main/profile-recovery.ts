/**
 * Profile cache-lock recovery policy — the "Unable to move the cache:
 * Access is denied. (0x5)" fix.
 *
 * THE INCIDENT (v1.1.7): on Windows the user's dev console showed
 *
 *    Unable to move the cache: Access is denied. (0x5)
 *    Unable to create cache
 *    Gpu Cache Creation failed: -2
 *
 * and pages would not load. Causes: a second Aether/electron process still
 * running in the background (an old dev instance, or a zombie electron.exe),
 * antivirus, or OneDrive syncing %APPDATA% — any of them holds a file lock on
 * the profile's Cache / Gpu Cache directories. Chromium cannot build its HTTP
 * cache there and the network stack degrades.
 *
 * POLICY: before anything touches the profile, probe the cache directory for
 * writability. If it is locked, relocate the WHOLE userData directory to a
 * deterministic sibling (`<profile>-recovered`, `-recovered-2`, `-recovered-3`)
 * so Chromium gets a fresh, unlocked cache — the browser keeps working. The
 * old profile is never deleted; the banner tells the user exactly how to
 * reclaim their bookmarks/history once the locking process is gone.
 *
 * This module is PURE (no electron import) so the decision logic is fully
 * unit-testable; preboot.ts wires it to the real fs.
 */
import path from 'node:path'

export type RecoveryReason = 'ok' | 'locked' | 'fallback-locked'

export interface ProfileDecision {
  /** The userData dir Aether was originally pointed at. */
  original: string
  /** The userData dir to actually use (=== original when not relocated). */
  dir: string
  /** True when we moved to a recovered profile. */
  relocated: boolean
  /** ok = original writable; locked = moved; fallback-locked = everything locked. */
  reason: RecoveryReason
}

/** How many recovery siblings we are willing to try before giving up. */
export const MAX_RECOVERY_CANDIDATES = 3

/**
 * Deterministic recovery profiles next to the original one, in trial order.
 * Deterministic matters: boot #2 re-uses the SAME recovered profile, so the
 * user's settings (written after recovery) keep working on later boots.
 */
export function recoveryCandidates(originalUserData: string): string[] {
  const out: string[] = []
  for (let i = 1; i <= MAX_RECOVERY_CANDIDATES; i++) {
    out.push(i === 1 ? `${originalUserData}-recovered` : `${originalUserData}-recovered-${i}`)
  }
  return out
}

/**
 * Decide which userData dir to boot with.
 *
 * @param userDataDir the default userData path
 * @param probe       answers "can I create + write + delete a file in dir?"
 *                    (preboot supplies a real fs probe; tests supply a fake)
 * @param forceLocked test hook — pretend the original cache is locked
 *                    (used by CI to exercise the full recovery path)
 */
export function decideProfileDir(
  userDataDir: string,
  probe: (dir: string) => boolean,
  forceLocked = false
): ProfileDecision {
  // Chromium needs <userData>/Cache specifically — probe exactly that.
  const originalCache = path.join(userDataDir, 'Cache')
  const locked = forceLocked || !probe(originalCache)
  if (!locked) {
    return { original: userDataDir, dir: userDataDir, relocated: false, reason: 'ok' }
  }
  for (const candidate of recoveryCandidates(userDataDir)) {
    if (probe(path.join(candidate, 'Cache'))) {
      return { original: userDataDir, dir: candidate, relocated: true, reason: 'locked' }
    }
  }
  // Everything is locked — keep the original and let Chromium degrade
  // gracefully (in-memory cache) rather than thrash through more dirs.
  return { original: userDataDir, dir: userDataDir, relocated: false, reason: 'fallback-locked' }
}

/**
 * Human-facing recovery banner. Printed to the console when we relocate.
 * Must name the EXACT old and new profile dirs and the Windows steps to
 * reclaim the old one — "fix it somehow" must not mean silent data loss.
 */
export function recoveryBanner(originalUserData: string, newUserData: string): string[] {
  return [
    '',
    '====================================================================',
    '  Aether: the browser profile cache is LOCKED by another process.',
    '  (this is what "Unable to move the cache: Access is denied (0x5)"',
    '   and "Gpu Cache Creation failed" mean)',
    '  Usual causes: another Aether / electron.exe still running in the',
    '  background, antivirus, or OneDrive syncing the AppData folder.',
    '',
    `  Old profile (KEPT, nothing deleted): ${originalUserData}`,
    `  Using a fresh profile for now:       ${newUserData}`,
    '',
    '  To get your old bookmarks/history back:',
    '    1. Close all Aether windows.',
    '    2. Task Manager (Ctrl+Shift+Esc) -> end every "electron.exe"',
    '       and "Aether.exe" process.',
    '    3. If OneDrive/antivirus locks the old folder, pause it.',
    '    4. Delete (or rename) the old profile folder above, then',
    '       start Aether again — it will reuse the original profile.',
    '====================================================================',
    ''
  ]
}
