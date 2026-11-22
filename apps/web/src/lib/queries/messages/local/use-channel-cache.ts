import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableChannelLocalSync } from '@core/constant/featureFlags';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import {
  getGraphqlSoupCacheHost,
  subscribeGraphqlSoupReconnected,
} from '@service-storage/graphql-soup';
import { onlineManager } from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  rereadChannelsAfterStorageReset,
  resetChannelSync,
  storeUnstoredPushes,
} from './catch-up';
import { channelCacheHost } from './flag';
import {
  changeLeftBehindOverRest,
  queueIfAnswering,
  sendLeftBehindOverRest,
} from './left-behind-sends';
import { resetPendingChannelPages } from './pages';
import { evictIdleChannels, runChannelPrewarmPass } from './prewarm';
import { loadPrewarmChannelIds } from './prewarm-list';
import { setQueueOwner } from './queue-owner';
import { resetSendsInHand } from './sends-in-hand';
import { holdUnheldReads } from './source';
import { holdUnqueuedSendsPage, resendUnqueuedSends } from './unqueued-sends';
import { resetUnsettledReplies } from './unsettled-replies';
import { makeChannelChange, sendChannelMessage } from './writes';

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
  // Offline the lists cannot be asked for; the pass after the reconnect runs.
  if (signal.aborted || !onlineManager.isOnline()) return;
  const outcome = await runChannelPrewarmPass(host, loadPrewarmChannelIds, {
    signal,
    ready: whenIdle,
  });
  if (outcome.unavailable || signal.aborted) return;
  await evictIdleChannels(host, { signal });
}

/**
 * While `userId` is signed in and channels read from the device cache
 * (`enable-channel-local-sync`), the cross-tab
 * leader keeps up to forty unread and the twenty most recently used channels
 * ready (asking for the lists again as a pass ends, for channels that became
 * unread meanwhile), one request at a time and only while the person leaves the app alone,
 * again after a reconnect or a replaced cache, and drops channels not opened
 * for thirty days. When the cache storage is reset under the page, the open
 * channels' pages and threads are read again so the device holds them again.
 * Each tab also sends the messages a page that is gone was still handing to
 * the device queue, stores the pushed changes such a page had shown but the
 * device had not taken, and has the device hold the channel pages and threads
 * such a page had shown from the server before the device stored them. With the flag off none of this runs; the sends an
 * earlier page left noted are posted over REST.
 */
export function useChannelCache(userId: Accessor<string | undefined>): void {
  const active = () => userId() !== undefined;
  const localSync = useFeatureFlag(enableChannelLocalSync);
  const isLeader = createTabLeaderSignal('graphql-channel-prewarm:v1');
  const [pass, setPass] = createSignal(0);
  const host = () => (localSync().enabled ? channelCacheHost() : undefined);

  createEffect(() => {
    const cacheHost = host();
    if (!cacheHost || !active()) return;
    const again = () => setPass((value) => value + 1);
    const unsubscribeReconnect = subscribeGraphqlSoupReconnected(again);
    const unsubscribeGeneration = cacheHost.onCacheGenerationChanged(
      (change) => {
        if (change.storage === 'reset') rereadChannelsAfterStorageReset();
        again();
      }
    );
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
      resetUnsettledReplies();
      resetSendsInHand();
    });
  });

  createEffect(() => {
    // The device queue is this person's: its waiting messages are theirs.
    setQueueOwner(userId());
    onCleanup(() => setQueueOwner(undefined));
  });

  createEffect(() => {
    const cacheHost = host();
    const sender = userId();
    if (!cacheHost || !sender) return;
    holdUnqueuedSendsPage();
    fireAndForget(
      resendUnqueuedSends(cacheHost, sender, {
        send: (send, createdAt) =>
          fireAndForget(
            sendChannelMessage(cacheHost, send, {
              now: () => new Date(createdAt),
            }),
            'channel-local-sync'
          ),
        change: (change, createdAt) =>
          fireAndForget(
            makeChannelChange(cacheHost, change, {
              now: () => new Date(createdAt),
            }),
            'channel-local-sync'
          ),
      }),
      'channel-local-sync'
    );
  });

  createEffect(() => {
    const sender = userId();
    const flag = localSync();
    // Channels are on REST here. What an earlier page noted for the queue is
    // posted over REST, unless the queue turns out to hold it: the cache
    // delivers its queue whatever this flag says.
    if (!sender || flag.loading || flag.enabled) return;
    // Other pages starting now leave to this one what it takes over.
    holdUnqueuedSendsPage();
    const queue = queueIfAnswering(untrack(getGraphqlSoupCacheHost));
    fireAndForget(
      resendUnqueuedSends(queue, sender, {
        send: (send) =>
          fireAndForget(sendLeftBehindOverRest(send), 'channel-local-sync'),
        change: (change) =>
          fireAndForget(changeLeftBehindOverRest(change), 'channel-local-sync'),
      }),
      'channel-local-sync'
    );
  });

  createEffect(() => {
    const cacheHost = host();
    if (!cacheHost || !active()) return;
    // Again after a reconnect: offline, the catch-up fails and stays noted.
    pass();
    fireAndForget(storeUnstoredPushes(cacheHost), 'channel-local-sync');
    fireAndForget(holdUnheldReads(cacheHost), 'channel-local-sync');
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
