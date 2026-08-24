/**
 * Identity for the first-party "Cursor" system bot. Mirrors
 * `bot_id::CURSOR_BOT_ID` on the backend. Mentioning it opens an agent
 * session served by a Cursor cloud agent rather than a Macro-managed sandbox
 * (see `macroCoder.ts` for the sandboxed sibling).
 */
export const CURSOR_BOT_ID = '00000000-0000-0000-0000-00000000c5c5';

/**
 * Canonical principal id for the Cursor bot, matching the `bot|<uuid>` form
 * used for bot senders and participants everywhere else.
 */
export const CURSOR_BOT_PRINCIPAL_ID = `bot|${CURSOR_BOT_ID}`;

/** Display name for the Cursor bot. */
export const CURSOR_BOT_NAME = 'Cursor';

/** Handle used to find the Cursor bot in the mention typeahead (`@cursor`). */
export const CURSOR_BOT_HANDLE = 'cursor';

/** Whether an email belongs to a Macro staff account. */
export function isMacroStaffEmail(email: string | undefined): boolean {
  const parts = email?.toLowerCase().split('@');
  return parts?.length === 2 && parts[1] === 'macro.com';
}

/**
 * Whether an id refers to the Cursor bot. Accepts both the bare UUID and the
 * `bot|<uuid>` participant/sender form.
 */
export function isCursorBotId(id: string | undefined): boolean {
  if (!id) return false;
  const bare = id.startsWith('bot|') ? id.slice('bot|'.length) : id;
  return bare === CURSOR_BOT_ID;
}
