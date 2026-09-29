import { CODEX_BOT_NAME, isCodexBotId } from '@core/constant/codexAgent';
import { CURSOR_BOT_NAME, isCursorBotId } from '@core/constant/cursorAgent';
import { isMacroAgentId, MACRO_AGENT_NAME } from '@core/constant/macroAgent';
import { isMacroCoderId, MACRO_CODER_NAME } from '@core/constant/macroCoder';
import { isMacroNewId } from '@core/constant/macroNew';
import { isMacroSystemId, MACRO_SYSTEM_NAME } from '@core/constant/macroSystem';

/**
 * Display name for a first-party bot (bare UUID or `bot|<uuid>`), resolved
 * from constants so it never waits on the bots list. Undefined for team bots.
 */
export function firstPartyBotName(id: string): string | undefined {
  // Both Macro bots present as "Macro": the chat reply and the agent session
  // are the same persona to a reader, only a different id on the wire.
  if (isMacroAgentId(id) || isMacroNewId(id)) return MACRO_AGENT_NAME;
  if (isMacroCoderId(id)) return MACRO_CODER_NAME;
  if (isCodexBotId(id)) return CODEX_BOT_NAME;
  if (isCursorBotId(id)) return CURSOR_BOT_NAME;
  if (isMacroSystemId(id)) return MACRO_SYSTEM_NAME;
  return undefined;
}
