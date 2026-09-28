import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { openChatWithMessage } from '@app/features/chat/ChatWithAgentButton';
import { globalSplitManager } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import {
  enableChatV3Agents,
  isFeatureEnabled,
} from '@core/constant/featureFlags';

/**
 * Opens a conversation for a mobile search query and sends it immediately.
 * With chat v3 agents, that is a managed agent session whose first prompt is
 * the query. Otherwise it is the cognition chat.
 */
export function openMobileAskAi(query: string) {
  if (!isFeatureEnabled(enableChatV3Agents)) {
    void openChatWithMessage(query);
    return;
  }

  const manager = globalSplitManager();
  if (!manager) {
    toast.failure('Unable to open chat');
    return;
  }

  manager.openWithSplit(
    { type: 'agent', id: startPendingSession({ prompt: query }) },
    { activate: true, preferNewSplit: true }
  );
}
