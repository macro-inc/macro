/**
 * Identity for the first-party "macro(new)" system bot. Mirrors
 * `bot_id::MACRO_NEW_BOT_ID` on the backend. Deliberately a distinct bot from
 * Macro (see `macroAgent.ts`): mentioning Macro answers in chat, while
 * mentioning macro(new) opens an agent session on the in-process runtime.
 */
export const MACRO_NEW_BOT_ID = '00000000-0000-0000-0000-00000000a2a2';

/**
 * Canonical principal id for macro(new), matching the `bot|<uuid>` form used
 * for bot senders and participants everywhere else.
 */
export const MACRO_NEW_PRINCIPAL_ID = `bot|${MACRO_NEW_BOT_ID}`;

/** Display name for macro(new). */
export const MACRO_NEW_NAME = 'macro(new)';

/** Handle used to find macro(new) in the mention typeahead (`@macro-new`). */
export const MACRO_NEW_HANDLE = 'macro-new';

/**
 * Whether an id refers to the macro(new) bot. Accepts both the bare UUID and
 * the `bot|<uuid>` participant/sender form.
 */
export function isMacroNewId(id: string | undefined): boolean {
  if (!id) return false;
  const bare = id.startsWith('bot|') ? id.slice('bot|'.length) : id;
  return bare === MACRO_NEW_BOT_ID;
}
