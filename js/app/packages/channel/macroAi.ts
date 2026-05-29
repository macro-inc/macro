import type { IUser } from '@core/user/types';

/**
 * Stable identity for the first-party "Macro AI" system bot. Mirrors
 * `bot_id::MACRO_AI_BOT_ID` on the backend. Macro AI is a participant in every
 * channel; mentioning it triggers an AI reply in a thread.
 */
export const MACRO_AI_BOT_ID = '00000000-0000-0000-0000-00000000a1a1';

/** Handle shown for Macro AI mentions (renders as `@macro`). */
export const MACRO_AI_HANDLE = 'macro';

/** Display name for Macro AI. */
export const MACRO_AI_NAME = 'Macro AI';

/** Whether an id refers to the Macro AI bot. */
export function isMacroAiId(id: string): boolean {
  return id === MACRO_AI_BOT_ID;
}

/**
 * A synthetic [`IUser`] entry so Macro AI appears in the channel `@`-mention
 * typeahead. The mention rides the existing user-mention machinery and is
 * re-tagged as a bot mention at send time (see `expandMentions`).
 */
export function macroAiMentionUser(): IUser {
  return {
    id: MACRO_AI_BOT_ID,
    name: MACRO_AI_NAME,
    email: MACRO_AI_HANDLE,
  };
}
