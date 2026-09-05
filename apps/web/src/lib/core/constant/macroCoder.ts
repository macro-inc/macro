/**
 * Identity for the first-party "Macro Coder" system bot. Mirrors
 * `bot_id::MACRO_CODER_BOT_ID` on the backend. Deliberately a distinct bot
 * from Macro (see `macroAgent.ts`): mentioning Macro answers in chat, while
 * mentioning Macro Coder opens a sandboxed coding-agent session.
 */
export const MACRO_CODER_BOT_ID = '00000000-0000-0000-0000-00000000a9e7';

/**
 * Canonical principal id for Macro Coder, matching the `bot|<uuid>` form used
 * for bot senders and participants everywhere else.
 */
export const MACRO_CODER_PRINCIPAL_ID = `bot|${MACRO_CODER_BOT_ID}`;

/** Display name for Macro Coder. */
export const MACRO_CODER_NAME = 'Macro Coder';

/** Handle used to find Macro Coder in the mention typeahead (`@coder`). */
export const MACRO_CODER_HANDLE = 'coder';

/**
 * Whether an id refers to the Macro Coder bot. Accepts both the bare UUID and
 * the `bot|<uuid>` participant/sender form.
 */
export function isMacroCoderId(id: string | undefined): boolean {
  if (!id) return false;
  const bare = id.startsWith('bot|') ? id.slice('bot|'.length) : id;
  return bare === MACRO_CODER_BOT_ID;
}
