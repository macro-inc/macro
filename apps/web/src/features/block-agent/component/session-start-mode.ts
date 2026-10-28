/** How a newly created agent session should be opened. */
export type SessionStartMode = 'live' | 'background';

/** User-scoped localStorage key for the composer's start-mode toggle. */
export const SESSION_START_MODE_STORAGE_KEY = 'agent-session-start-mode-v1';

export function isSessionStartMode(value: unknown): value is SessionStartMode {
  return value === 'live' || value === 'background';
}

/** Unknown or missing storage values fall back to a live session. */
export function parseSessionStartMode(value: unknown): SessionStartMode {
  return isSessionStartMode(value) ? value : 'live';
}

/**
 * Cmd/Ctrl previews background only while the committed choice is live.
 * A user-set background mode ignores the modifier so releasing it cannot
 * bounce the dropdown back to live.
 */
export function effectiveSessionStartMode(
  committed: SessionStartMode,
  cmdHeld: boolean
): SessionStartMode {
  if (committed === 'background') return 'background';
  return cmdHeld ? 'background' : 'live';
}
