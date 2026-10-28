/**
 * Identity for the autonomous Macro platform principal. Mirrors
 * `bot_id::MACRO_SYSTEM_BOT_ID` on the backend, which attributes actions the
 * platform takes on its own (onboarding seeds, scheduled jobs) to this bot.
 */
export const MACRO_SYSTEM_BOT_ID = '00000000-0000-0000-0000-000000005759';

/**
 * Canonical principal id for the system bot, matching the `bot|<uuid>` form
 * used for bot senders, participants, and activity actors everywhere else.
 */
export const MACRO_SYSTEM_PRINCIPAL_ID = `bot|${MACRO_SYSTEM_BOT_ID}`;

/** Display name for the system principal. */
export const MACRO_SYSTEM_NAME = 'System';

/**
 * Whether an id refers to the system bot. Accepts both the bare UUID and the
 * `bot|<uuid>` participant/sender form.
 */
export function isMacroSystemId(id: string | undefined): boolean {
  if (!id) return false;
  const bare = id.startsWith('bot|') ? id.slice('bot|'.length) : id;
  return bare === MACRO_SYSTEM_BOT_ID;
}
