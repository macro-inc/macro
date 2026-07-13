import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS } from '@channel/Channel/link';

/**
 * Focuses the channel split (opens if needed) and pushes the
 * `?join_call=true` deep-link param so `ChannelCallAutoJoin` drops the user
 * straight into the call. Used for accept-call flows like clicking an
 * incoming-call browser notification.
 */
export async function joinChannelCall(channelId: string): Promise<void> {
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
    [URL_PARAMS.joinCall]: 'true',
  });
}
