import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS } from '@channel/Channel/link';
import type { CallJoinIntent } from './call-lifecycle';

/**
 * Focus the channel and carry the selected session through navigation.
 * Only an explicit Start action sends the creation-capable intent.
 */
export async function joinChannelCall(
  channelId: string,
  intent: CallJoinIntent = { kind: 'join' }
): Promise<void> {
  const manager = globalSplitManager();
  if (!manager || !channelId) return;

  const existing = manager.getSplitByContent('channel', channelId);
  if (existing) {
    existing.activate();
  } else {
    manager.openWithSplit(
      { type: 'channel', id: channelId },
      { activate: true, referredFrom: 'sidebar' }
    );
  }

  const orchestrator = manager.getOrchestrator();
  const handle = await orchestrator.getBlockHandle(channelId, 'channel');
  await handle?.goToLocationFromParams({
    [URL_PARAMS.joinCall]:
      intent.kind === 'start' ? 'start' : (intent.callId ?? 'true'),
  });
}
