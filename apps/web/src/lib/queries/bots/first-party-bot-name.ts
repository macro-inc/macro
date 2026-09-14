import { CURSOR_BOT_NAME, isCursorBotId } from '@core/constant/cursorAgent';
import { isMacroAgentId, MACRO_AGENT_NAME } from '@core/constant/macroAgent';
import { isMacroCoderId, MACRO_CODER_NAME } from '@core/constant/macroCoder';
import { isMacroNewId, MACRO_NEW_NAME } from '@core/constant/macroNew';
import { isMacroSystemId, MACRO_SYSTEM_NAME } from '@core/constant/macroSystem';

/**
 * Display name for a first-party bot (bare UUID or `bot|<uuid>`), resolved
 * from constants so it never waits on the bots list. Undefined for team bots.
 */
export function firstPartyBotName(id: string): string | undefined {
  if (isMacroAgentId(id)) return MACRO_AGENT_NAME;
  if (isMacroCoderId(id)) return MACRO_CODER_NAME;
  if (isMacroNewId(id)) return MACRO_NEW_NAME;
  if (isCursorBotId(id)) return CURSOR_BOT_NAME;
  if (isMacroSystemId(id)) return MACRO_SYSTEM_NAME;
  return undefined;
}
