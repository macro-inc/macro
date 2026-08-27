import {
  CURSOR_BOT_NAME,
  CURSOR_BOT_PRINCIPAL_ID,
} from '@core/constant/cursorAgent';
import {
  MACRO_AGENT_NAME,
  MACRO_AGENT_PRINCIPAL_ID,
} from '@core/constant/macroAgent';
import {
  MACRO_CODER_NAME,
  MACRO_CODER_PRINCIPAL_ID,
} from '@core/constant/macroCoder';
import type { IUser } from '@core/user/types';

// Re-export the shared Macro identity under the names used in this package.
export {
  isMacroAgentId as isMacroAiId,
  MACRO_AGENT_BOT_ID as MACRO_AI_BOT_ID,
  MACRO_AGENT_HANDLE as MACRO_AI_HANDLE,
  MACRO_AGENT_NAME as MACRO_AI_NAME,
  MACRO_AGENT_PRINCIPAL_ID as MACRO_AI_PRINCIPAL_ID,
} from '@core/constant/macroAgent';
export { isMacroCoderId } from '@core/constant/macroCoder';

/**
 * A synthetic [`IUser`] entry so Macro appears in the channel `@`-mention
 * typeahead. The mention rides the existing user-mention machinery and is
 * re-tagged as a bot mention at send time (see `expandMentions`). `email` is set
 * to the display name so the typeahead shows just "Macro". The id uses the
 * canonical `bot|<uuid>` principal form so persisted mention content matches
 * bot sender/participant ids.
 */
export function macroAiMentionUser(): IUser {
  return {
    id: MACRO_AGENT_PRINCIPAL_ID,
    name: MACRO_AGENT_NAME,
    email: MACRO_AGENT_NAME,
  };
}

/**
 * A synthetic [`IUser`] entry so Macro Coder appears in the channel
 * `@`-mention typeahead, exactly like [`macroAiMentionUser`]. Mentioning it
 * opens a sandboxed coding-agent session rather than a chat reply.
 */
export function macroCoderMentionUser(): IUser {
  return {
    id: MACRO_CODER_PRINCIPAL_ID,
    name: MACRO_CODER_NAME,
    email: MACRO_CODER_NAME,
  };
}

/**
 * The Cursor bot as a synthetic mention user, exactly like
 * [`macroCoderMentionUser`]. Mentioning it opens an agent session served by
 * a Cursor cloud agent.
 */
export function cursorMentionUser(): IUser {
  return {
    id: CURSOR_BOT_PRINCIPAL_ID,
    name: CURSOR_BOT_NAME,
    email: CURSOR_BOT_NAME,
  };
}
