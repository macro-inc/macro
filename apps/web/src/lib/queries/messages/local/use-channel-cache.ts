import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import { subscribeGraphqlSoupReconnected } from '@service-storage/graphql-soup';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { resetChannelSync } from './catch-up';
import { channelCacheHost } from './flag';
import { resetPendingChannelPages } from './pages';
import { evictIdleChannels, runChannelPrewarm } from './prewarm';
import { loadPrewarmChannelIds } from './prewarm-list';

/** Leaves startup and the first screen alone. */
const START_DELAY_MS = 5_000;
/** Picks up channels that became unread or recently used since the last pass. */
const PREWARM_INTERVAL_MS = 10 * 60_000;

/** How long the person must leave the app alone before the next channel. */
const QUIET_MS = 3_000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

let lastInputAt = 0;
const noteInput = () => {
  lastInputAt = Date.now();
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

/** Resolves once the person has left the app alone and the browser is idle. */
async function whenIdle(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const quietFor = Date.now() - lastInputAt;
    if (quietFor >= QUIET_MS) break;
    await sleep(QUIET_MS - quietFor, signal);
  }
  if (signal.aborted || typeof requestIdleCallback === 'undefined') return;
  await new Promise<void>((resolve) => {
    requestIdleCallback(() => resolve(), { timeout: START_DELAY_MS });
  });
}

async function runPass(host: CacheHost, signal: AbortSignal): Promise<void> {
  await sleep(START_DELAY_MS, signal);
  await whenIdle(signal);
  if (signal.aborted) return;
  const channelIds = await loadPrewarmChannelIds();
  if (signal.aborted) return;
  const outcome = await runChannelPrewarm(host, channelIds, {
    signal,
    ready: whenIdle,
  });
  if (outcome.unavailable || signal.aborted) return;
  await evictIdleChannels(host, { signal });
}

/**
 * While `active` and channels read from the device cache, the cross-tab
 * leader keeps up to forty unread and the twenty most recently used channels
 * ready, one request at a time and only while the person leaves the app alone,
 * again after a reconnect or a replaced cache, and drops channels not opened
 * for thirty days.
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
    for (const event of INPUT_EVENTS) {
      window.addEventListener(event, noteInput, {
        capture: true,
        passive: true,
      });
    }
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') again();
    }, PREWARM_INTERVAL_MS);
    onCleanup(() => {
      clearInterval(interval);
      for (const event of INPUT_EVENTS) {
        window.removeEventListener(event, noteInput, { capture: true });
      }
      unsubscribeGeneration();
      unsubscribeReconnect();
      // Sequence bookkeeping belongs to the account and cache it was read for.
      resetChannelSync();
      resetPendingChannelPages();
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
