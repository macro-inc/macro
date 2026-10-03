import { isClaudeBotId } from '@core/constant/claudeAgent';
import { isCodexBotId } from '@core/constant/codexAgent';
import { isCursorBotId } from '@core/constant/cursorAgent';
import { useCursorAgentsAccess } from '@core/cursor/flag';
import type { IUser } from '@core/user/types';
import { uniqueByKey } from '@core/util/compareUtils';
import type { Accessor } from 'solid-js';
import {
  claudeMentionUser,
  codexMentionUser,
  cursorMentionUser,
  isMacroAiId,
  isMacroCoderId,
  isMacroNewId,
  macroCoderMentionUser,
  macroMentionUser,
} from './macroAi';
import { useChatV3AgentsFlag } from './use-chat-v3-agents-flag';

/**
 * Built-in agent entries shared by every message composer. Account setup does
 * not hide a mention: the harness answers with a connection prompt in the
 * thread when setup is needed, so replies link to Settings → Harness rather
 * than the entry disappearing. The built-in Cursor entry follows the Cursor
 * rollout flag. Mentions are re-tagged as bot mentions at send time.
 *
 * Macro gets exactly one entry. Both Macro bots are dropped from the incoming
 * list first, so a stray participant or channel-bot row cannot put a second
 * "Macro" in the menu; the rollout then decides which id that one entry
 * carries.
 */
export function useAgentMentionUsers(
  users: Accessor<IUser[]>,
  enabled: Accessor<boolean> = () => true
): Accessor<IUser[]> {
  const canUseCursor = useCursorAgentsAccess();
  const canUseAgents = useChatV3AgentsFlag();

  return () => {
    if (!enabled()) return users();
    const base = users().filter(
      (user) =>
        (canUseCursor() || !isCursorBotId(user.id)) &&
        !isMacroAiId(user.id) &&
        !isMacroNewId(user.id)
    );
    if (canUseAgents() && !base.some((user) => isMacroCoderId(user.id))) {
      base.unshift(macroCoderMentionUser());
    }
    if (canUseCursor() && !base.some((user) => isCursorBotId(user.id))) {
      base.unshift(cursorMentionUser());
    }
    if (!base.some((user) => isCodexBotId(user.id))) {
      base.unshift(codexMentionUser());
    }
    if (!base.some((user) => isClaudeBotId(user.id))) {
      base.unshift(claudeMentionUser());
    }
    base.unshift(macroMentionUser(canUseAgents()));
    return uniqueByKey(base, (user) => user.id);
  };
}
