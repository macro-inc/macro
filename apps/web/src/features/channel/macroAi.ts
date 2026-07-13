import {
  MACRO_AGENT_NAME,
  MACRO_AGENT_PRINCIPAL_ID,
} from '@core/constant/macroAgent';
import type { IUser } from '@core/user/types';

// Re-export the shared Macro identity under the names used in this package.
export {
  isMacroAgentId as isMacroAiId,
  MACRO_AGENT_BOT_ID as MACRO_AI_BOT_ID,
  MACRO_AGENT_HANDLE as MACRO_AI_HANDLE,
  MACRO_AGENT_NAME as MACRO_AI_NAME,
  MACRO_AGENT_PRINCIPAL_ID as MACRO_AI_PRINCIPAL_ID,
} from '@core/constant/macroAgent';

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
