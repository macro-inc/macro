/**
 * Identity for the agent-session half of Macro. Mirrors
 * `bot_id::MACRO_NEW_BOT_ID` on the backend. A distinct bot from the classic
 * chat reply (see `macroAgent.ts`) because one id cannot mean both, but not a
 * distinct persona: both are "Macro", and the chat-v3 rollout decides which of
 * the two a single `@macro` mention targets.
 */
export const MACRO_NEW_BOT_ID = '00000000-0000-0000-0000-00000000a2a2';

/**
 * Canonical principal id for the agent-session Macro bot, matching the
 * `bot|<uuid>` form used for bot senders and participants everywhere else.
 */
export const MACRO_NEW_PRINCIPAL_ID = `bot|${MACRO_NEW_BOT_ID}`;

/**
 * Whether an id refers to the agent-session Macro bot. Accepts both the bare
 * UUID and the `bot|<uuid>` participant/sender form.
 */
export function isMacroNewId(id: string | undefined): boolean {
  if (!id) return false;
  const bare = id.startsWith('bot|') ? id.slice('bot|'.length) : id;
  return bare === MACRO_NEW_BOT_ID;
}
