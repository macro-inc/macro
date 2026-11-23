import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableChannelLocalSync } from '@core/constant/featureFlags';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { subscribeGraphqlSoupReconnected } from '@service-storage/graphql-soup';
import { makeEventListener } from '@solid-primitives/event-listener';
import { onlineManager } from '@tanstack/solid-query';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { channelCacheHost } from './channel-flag';
import {
  createChannelPrewarm,
  createUserQuiet,
  loadPrewarmChannelIds,
} from './channel-prewarm';
import { channelSyncRuntime, channelTouches } from './channel-sync';

/** Leaves startup and the first screen alone. */
const START_DELAY_MS = 5_000;
/** Picks up channels that became unread or recently opened since the last pass. */
const PREWARM_INTERVAL_MS = 10 * 60_000;

/**
 * While someone is signed in and channels read from the device cache
 * (`enable-channel-local-sync`), the tab that leads keeps up to forty unread
 * and the twenty most recently opened channels' latest pages on the device,
 * and drops channels nobody opened for thirty days. A pass runs after
 * startup, after a reconnect or a replaced cache, on coming back online, and
 * every ten minutes while the tab is visible. With the flag off, nothing runs.
 */
export function useChannelPrewarm(active: Accessor<boolean>): void {
  const localSync = useFeatureFlag(enableChannelLocalSync);
  const isLeader = createTabLeaderSignal('graphql-channel-prewarm:v2');

  createEffect(() => {
    if (!active() || !isLeader() || !localSync().enabled) return;
    const host = channelCacheHost();
    if (!host) return;
    const quiet = createUserQuiet();
    const prewarm = createChannelPrewarm({
      host,
      runtime: channelSyncRuntime(host),
      touches: channelTouches(host),
      listChannels: () => loadPrewarmChannelIds(),
      idle: quiet.idle,
      online: () => onlineManager.isOnline(),
    });
    const again = () => prewarm.run();
    prewarm.run(START_DELAY_MS);
    const stopReconnect = subscribeGraphqlSoupReconnected(again);
    const stopGeneration = host.onCacheGenerationChanged(again);
    const stopOnline = makeEventListener(window, 'online', again);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') again();
    }, PREWARM_INTERVAL_MS);
    onCleanup(() => {
      clearInterval(interval);
      stopOnline();
      stopGeneration();
      stopReconnect();
      prewarm.dispose();
      quiet.dispose();
    });
  });
}
