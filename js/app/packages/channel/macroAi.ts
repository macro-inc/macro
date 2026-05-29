import {
  MACRO_AGENT_BOT_ID,
  MACRO_AGENT_NAME,
} from '@core/constant/macroAgent';
import type { IUser } from '@core/user/types';

// Re-export the shared Macro Agent identity under the names used in this package.
export {
  MACRO_AGENT_BOT_ID as MACRO_AI_BOT_ID,
  MACRO_AGENT_NAME as MACRO_AI_NAME,
  MACRO_AGENT_HANDLE as MACRO_AI_HANDLE,
  isMacroAgentId as isMacroAiId,
} from '@core/constant/macroAgent';

/**
 * A synthetic [`IUser`] entry so Macro Agent appears in the channel `@`-mention
 * typeahead. The mention rides the existing user-mention machinery and is
 * re-tagged as a bot mention at send time (see `expandMentions`). `email` is set
 * to the display name so the typeahead shows just "Macro Agent".
 */
export function macroAiMentionUser(): IUser {
  return {
    id: MACRO_AGENT_BOT_ID,
    name: MACRO_AGENT_NAME,
    email: MACRO_AGENT_NAME,
  };
}
