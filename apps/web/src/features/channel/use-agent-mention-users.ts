import { isClaudeBotId } from '@core/constant/claudeAgent';
import { isCodexBotId } from '@core/constant/codexAgent';
import { isCursorBotId } from '@core/constant/cursorAgent';
import {
  enableChatV3Agents,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { isMacroSystemId } from '@core/constant/macroSystem';
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
  macroAiMentionUser,
  macroCoderMentionUser,
  macroNewMentionUser,
} from './macroAi';
import { useDocumentAgentRoster } from './use-channel-bot-mention-users';

/**
 * Built-in agent entries shared by every message composer. Account setup does
 * not hide a mention: the harness answers with a connection prompt in the
 * thread when setup is needed, so replies link to Settings → Harness rather
 * than the entry disappearing. The built-in Cursor entry follows the Cursor
 * rollout flag. Mentions are re-tagged as bot mentions at send time.
 */
export function useAgentMentionUsers(
  users: Accessor<IUser[]>,
  enabled: Accessor<boolean> = () => true
): Accessor<IUser[]> {
  const canUseCursor = useCursorAgentsAccess();

  return () => {
    if (!enabled()) return users();
    const base = users().filter(
      (user) => canUseCursor() || !isCursorBotId(user.id)
    );
    if (
      isFeatureEnabled(enableChatV3Agents) &&
      !base.some((user) => isMacroCoderId(user.id))
    ) {
      base.unshift(macroCoderMentionUser());
    }
    if (
      isFeatureEnabled(enableChatV3Agents) &&
      !base.some((user) => isMacroNewId(user.id))
    ) {
      base.unshift(macroNewMentionUser());
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
    if (!base.some((user) => isMacroAiId(user.id))) {
      base.unshift(macroAiMentionUser());
    }
    return uniqueByKey(base, (user) => user.id);
  };
}

/**
 * The agents from a mention list that a task can be handed to: the ones whose
 * mention opens a session. Macro answers in the thread it was asked in and the
 * platform bot posts only on its own behalf, so assigning either would leave
 * the task sitting with nobody working on it.
 */
export function agentsAssignableToTasks(users: readonly IUser[]): IUser[] {
  return users.filter(
    (user) => !isMacroAiId(user.id) && !isMacroSystemId(user.id)
  );
}

/**
 * The agents a task can be assigned to, in the order the mention typeahead
 * offers them on a document.
 */
export function useTaskAssignableAgents(): Accessor<IUser[]> {
  const mentionUsers = useAgentMentionUsers(useDocumentAgentRoster());
  return () => agentsAssignableToTasks(mentionUsers());
}
