/**
 * Identity for the first-party "Macro" system bot. Mirrors
 * `bot_id::MACRO_AI_BOT_ID` on the backend. Macro is a global system bot
 * available in every channel; mentioning it triggers an AI reply in a thread.
 */
export const MACRO_AGENT_BOT_ID = '00000000-0000-0000-0000-00000000a1a1';

/** Display name for Macro. */
export const MACRO_AGENT_NAME = 'Macro';

/** Handle used to find Macro in the mention typeahead (`@macro`). */
export const MACRO_AGENT_HANDLE = 'macro';

/**
 * Whether an id refers to the Macro bot. Accepts both the bare UUID and
 * the `bot|<uuid>` participant/sender form.
 */
export function isMacroAgentId(id: string | undefined): boolean {
  if (!id) return false;
  const bare = id.startsWith('bot|') ? id.slice('bot|'.length) : id;
  return bare === MACRO_AGENT_BOT_ID;
}
