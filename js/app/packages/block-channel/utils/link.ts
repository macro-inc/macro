import { URL_PARAMS } from '@block-channel/constants';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitManager } from '@app/component/split-layout/layoutManager';
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

export function getUrlToMessage(
  channelId: string,
  messageId: string,
  threadId?: string
) {
  const origin = window.location.origin;
  let url = `${origin}/app/channel/${channelId}?${URL_PARAMS.message}=${messageId}`;
  if (threadId) {
    url += `&${URL_PARAMS.thread}=${threadId}`;
  }
  return url;
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
  const params = getChannelParams(messageId, threadId);
  const splitManager = options?.splitManager ?? globalSplitManager();
  if (!splitManager) return;

  const existing = splitManager.getSplitByContent('channel', channelId);
  if (existing) {
    existing.activate();
  } else {
    splitManager.openWithSplit(
      { type: 'channel', id: channelId, params },
      {
        activate: true,
        referredFrom: null,
        preferNewSplit: options?.preferNewSplit,
      }
    );
  }

  const handle = await orchestrator.getBlockHandle(channelId, 'channel');
  await handle?.goToLocationFromParams(params);
}
