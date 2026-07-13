import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS } from '@channel/Channel/link';
import { ENABLE_CALLKIT } from '@core/constant/featureFlags';
import { isPlatform, isTauri } from '@core/util/platform';

/**
 * Focuses the channel split (opens if needed) and switches to the Call tab
 * without triggering join-call flows.
 */
export async function openChannelCallTab(channelId: string): Promise<void> {
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
  if (ENABLE_CALLKIT && isTauri() && isPlatform('ios')) {
    return;
  }
  await handle?.goToLocationFromParams({
    [URL_PARAMS.openCallTab]: 'true',
  });
}
