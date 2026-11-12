import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import { subscribeGraphqlSoupReconnected } from '@service-storage/graphql-soup';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { loadChannelList } from '../../channel/channels';
import { resetChannelSync } from './catch-up';
import { channelCacheHost } from './flag';
import {
  evictIdleChannels,
  prewarmChannelIds,
  runChannelPrewarm,
} from './prewarm';

/** Leaves startup and the first screen alone. */
const START_DELAY_MS = 5_000;
/** Picks up channels that became unread or recently used since the last pass. */
const PREWARM_INTERVAL_MS = 10 * 60_000;

/** Resolves once the browser is idle (or shortly after, where it cannot say). */
function whenIdle(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (signal.aborted || typeof requestIdleCallback === 'undefined') {
        resolve();
        return;
      }
      requestIdleCallback(() => resolve(), { timeout: START_DELAY_MS });
    }, START_DELAY_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

async function runPass(host: CacheHost, signal: AbortSignal): Promise<void> {
  await whenIdle(signal);
  if (signal.aborted) return;
  const channels = await loadChannelList();
  if (signal.aborted) return;
  const outcome = await runChannelPrewarm(host, prewarmChannelIds(channels), {
    signal,
  });
  if (outcome.unavailable || signal.aborted) return;
  await evictIdleChannels(host, { signal });
}

/**
 * While `active` and channels read from the device cache, the cross-tab
 * leader keeps unread and recently used channels ready when idle, again after
 * a reconnect or a replaced cache, and drops channels not opened for thirty
 * days.
 */
export function useChannelCache(active: Accessor<boolean>): void {
  const graphqlSoup = useFeatureFlag(enableGraphqlSoup);
  const isLeader = createTabLeaderSignal('graphql-channel-prewarm:v1');
  const [pass, setPass] = createSignal(0);
  const host = () => (graphqlSoup().enabled ? channelCacheHost() : undefined);

  createEffect(() => {
    const cacheHost = host();
    if (!cacheHost || !active()) return;
    const again = () => setPass((value) => value + 1);
    const unsubscribeReconnect = subscribeGraphqlSoupReconnected(again);
    const unsubscribeGeneration = cacheHost.onCacheGenerationChanged(again);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') again();
    }, PREWARM_INTERVAL_MS);
    onCleanup(() => {
      clearInterval(interval);
      unsubscribeGeneration();
      unsubscribeReconnect();
      // Sequence bookkeeping belongs to the account and cache it was read for.
      resetChannelSync();
    });
  });

  createEffect(() => {
    const cacheHost = host();
    if (!cacheHost || !active() || !isLeader()) return;
    pass();
    const abort = new AbortController();
    const run = async () => {
      try {
        await runPass(cacheHost, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) Telemetry.error(error);
      }
    };
    // Failures are reported above; the next pass starts over.
    fireAndForget(run(), 'channel-local-sync');
    onCleanup(() => abort.abort());
  });
}
