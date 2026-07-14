import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS } from '@block-channel/constants';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import type { BlockOrchestrator } from '@core/orchestrator';

export function getChannelParams(
  messageId: string,
  threadId?: string
): Record<string, string> {
  const params: Record<string, string> = {};
  params[URL_PARAMS.message] = messageId;

  if (threadId) {
    params[URL_PARAMS.thread] = threadId;
  }

  return params;
}

/**
 * Drive an (already-mounted) channel block to a target message through its
 * block handle. The shared last mile for every "go to a channel message"
 * caller — always keyed on the `'channel'` block type so a stale id can't
 * resolve the wrong block.
 */
export async function goToChannelMessage(
  orchestrator: BlockOrchestrator,
  channelId: string,
  messageId: string,
  threadId?: string
) {
  const handle = await orchestrator.getBlockHandle(channelId, 'channel');
  await handle?.goToLocationFromParams(getChannelParams(messageId, threadId));
}

/**
 * Drive an (already-mounted) channel block to its latest message via the
 * block handle — a scroll-to-bottom with no highlight. Used for channel rows
 * that open at their latest activity rather than a targeted message; forces
 * the scroll even when the channel is already open (where `reopen: 'latest'`
 * would otherwise just reactivate the parked split).
 */
export async function goToChannelLatest(
  orchestrator: BlockOrchestrator,
  channelId: string
) {
  const handle = await orchestrator.getBlockHandle(channelId, 'channel');
  await handle?.goToLatest();
}

export async function navigateToChannelMessage(
  orchestrator: BlockOrchestrator,
  channelId: string,
  messageId: string,
  threadId?: string,
  options?: {
    splitManager?: SplitManager;
    preferNewSplit?: boolean;
  }
) {
  const splitManager = options?.splitManager ?? globalSplitManager();
  if (!splitManager) return;

  const existing = splitManager.getSplitByContent('channel', channelId);
  if (existing) {
    existing.activate();
  } else {
    splitManager.openWithSplit(
      {
        type: 'channel',
        id: channelId,
        params: getChannelParams(messageId, threadId),
      },
      {
        activate: true,
        referredFrom: null,
        preferNewSplit: options?.preferNewSplit,
      }
    );
  }

  await goToChannelMessage(orchestrator, channelId, messageId, threadId);
}
