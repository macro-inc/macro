import { navigateToChannelMessage } from '@block-channel/utils/link';
import type { BlockOrchestrator } from '@core/orchestrator';
import { Telemetry } from '@macro-inc/observability';

/**
 * Open a message of an embedded thread in its channel: the thread's own
 * message on its own, a reply inside the thread it belongs to.
 */
export function openThreadMessage(
  orchestrator: BlockOrchestrator,
  target: { channelId: string; threadMessageId: string; messageId: string },
  surface: string
) {
  const isReply = target.messageId !== target.threadMessageId;
  navigateToChannelMessage(
    orchestrator,
    target.channelId,
    target.messageId,
    isReply ? target.threadMessageId : undefined
  ).catch((error) => Telemetry.error(error, { surface }));
}
