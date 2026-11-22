import type { CacheHost } from '@graphql-cache/index';
import { MAX_EVICTED_CHANNELS } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import { onlineManager } from '@tanstack/solid-query';
import { catchUpAndRefresh, type FetchChannelChanges } from './catch-up';
import { type FetchChannelServerPage, loadChannelPage } from './pages';

/** The page a channel opens with. */
export const PREWARM_PAGE_SIZE = 50;
const CHANNEL_DELAY_MS = 500;
/**
 * How long a pass waits on a host that is still starting before it gives up
 * on it: the next pass is minutes away.
 */
const HOST_WAIT_MS = 45_000;
/** Channels not opened for this long leave the device. */
export const CHANNEL_EVICTION_AGE_MS = 30 * 86_400_000;
const MAX_EVICTION_PASSES = 10;

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

export type ChannelPrewarmHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit' | 'readRecordsByKeys'
>;

export interface ChannelPrewarmOutcome {
  /** Latest pages fetched because the device did not hold them. */
  fetched: number;
  /** Channels the device held, brought up to the server's sequence. */
  caughtUp: number;
  failed: number;
  /** The device cannot serve channels; nothing more to do on this host. */
  unavailable: boolean;
}

/**
 * Keeps the latest page of each listed channel on the device: fetches it when
 * missing, and otherwise replays what changed since the device last looked.
 * One channel at a time, each only once `ready` resolves. One channel failing
 * does not stop the rest.
 */
export async function runChannelPrewarm(
  host: ChannelPrewarmHost,
  channelIds: string[],
  options: {
    signal: AbortSignal;
    delayMs?: number;
    hostWaitMs?: number;
    /** Resolves when the next channel may start: the person is not using the app. */
    ready?: (signal: AbortSignal) => Promise<void>;
    fetchPage?: FetchChannelServerPage;
    fetchChanges?: FetchChannelChanges;
    now?: () => number;
  }
): Promise<ChannelPrewarmOutcome> {
  const { signal } = options;
  return Telemetry.span('channel.prewarm', async (span) => {
    const outcome: ChannelPrewarmOutcome = {
      fetched: 0,
      caughtUp: 0,
      failed: 0,
      unavailable: false,
    };
    span.setAttr('prewarm.channels', channelIds.length);
    for (const channelId of channelIds) {
      await options.ready?.(signal);
      if (signal.aborted) break;
      // Offline every channel would fail; the pass after the reconnect
      // starts over.
      if (!onlineManager.isOnline()) break;
      try {
        const loaded = await loadChannelPage(
          host,
          { channelId, limit: PREWARM_PAGE_SIZE },
          {
            signal,
            fetchPage: options.fetchPage,
            now: options.now,
            background: true,
            hostWaitMs: options.hostWaitMs ?? HOST_WAIT_MS,
          }
        );
        if (signal.aborted) break;
        if (loaded === 'unsupported' || loaded === 'not-ready') {
          outcome.unavailable = true;
          break;
        }
        if (loaded.source === 'server') {
          await loaded.stored;
          outcome.fetched += 1;
        } else {
          await catchUpAndRefresh(host, channelId, options.fetchChanges);
          outcome.caughtUp += 1;
        }
      } catch (error) {
        if (signal.aborted) break;
        outcome.failed += 1;
        Telemetry.error(error);
      }
      await sleep(options.delayMs ?? CHANNEL_DELAY_MS, signal);
    }
    span.setAttr('prewarm.fetched', outcome.fetched);
    span.setAttr('prewarm.caught_up', outcome.caughtUp);
    span.setAttr('prewarm.failed', outcome.failed);
    span.setAttr('prewarm.unavailable', outcome.unavailable);
    return outcome;
  });
}

/** How many times a pass asks again, once done, for channels listed since it began. */
export const PREWARM_FOLLOW_UPS = 2;
/** Channels warmed between two looks at the lists while a pass has more to warm. */
export const PREWARM_LOOK_EVERY = 8;
/** Looks at the lists one pass makes at most. */
export const PREWARM_MAX_LOOKS = 12;

/**
 * One pass: warms the listed channels, looking at the lists again every few
 * channels and once it is done, and warms the ones listed since first. A
 * channel becomes unread on the server a moment after its message is stored,
 * and a first pass takes half a minute, so a channel that turned unread
 * around its start is not on the first list; without the further looks it
 * would wait for the end of the pass, or for the next pass, minutes away.
 */
export async function runChannelPrewarmPass(
  host: ChannelPrewarmHost,
  loadChannelIds: () => Promise<string[]>,
  options: Parameters<typeof runChannelPrewarm>[2]
): Promise<ChannelPrewarmOutcome> {
  const total: ChannelPrewarmOutcome = {
    fetched: 0,
    caughtUp: 0,
    failed: 0,
    unavailable: false,
  };
  const listed = new Set<string>();
  /** Listed and not yet warmed, in warming order. */
  let waiting: string[] = [];
  let looks = 0;
  let followUps = 0;
  let looking = true;
  while (looking || waiting.length > 0) {
    // Offline the lists cannot be asked for; the pass after the reconnect runs.
    if (options.signal.aborted || !onlineManager.isOnline()) break;
    if (looking) {
      const done = waiting.length === 0;
      let asked: string[];
      try {
        // A further look waits for the person to leave the app alone, too.
        if (looks > 0) await options.ready?.(options.signal);
        if (options.signal.aborted) break;
        asked = await loadChannelIds();
      } catch (error) {
        // Only the first look fails the pass; the channels already listed are still warmed.
        if (looks === 0) throw error;
        if (!options.signal.aborted) Telemetry.error(error);
        asked = [];
        looking = false;
      }
      looks += 1;
      const fresh = asked.filter((id) => !listed.has(id));
      for (const id of fresh) listed.add(id);
      // The lists are most recent first, and so is what was listed since.
      waiting = [...fresh, ...waiting];
      if (done && looks > 1) followUps += 1;
      if (
        looks >= PREWARM_MAX_LOOKS ||
        followUps >= PREWARM_FOLLOW_UPS ||
        (done && fresh.length === 0)
      ) {
        looking = false;
      }
      if (options.signal.aborted) break;
    }
    const next = waiting.slice(0, looking ? PREWARM_LOOK_EVERY : undefined);
    waiting = waiting.slice(next.length);
    if (next.length === 0) continue;
    const outcome = await runChannelPrewarm(host, next, options);
    total.fetched += outcome.fetched;
    total.caughtUp += outcome.caughtUp;
    total.failed += outcome.failed;
    total.unavailable = outcome.unavailable;
    if (outcome.unavailable) break;
  }
  return total;
}

/**
 * Removes channels not opened for thirty days, with their messages. Resolves
 * to the number of channels removed.
 */
export async function evictIdleChannels(
  host: Pick<CacheHost, 'channelTimelineEvict'>,
  options: { signal: AbortSignal; now?: () => number }
): Promise<number> {
  return Telemetry.span('channel.evict_idle', async (span) => {
    const touchedBeforeMs =
      (options.now ?? Date.now)() - CHANNEL_EVICTION_AGE_MS;
    let evicted = 0;
    for (let pass = 0; pass < MAX_EVICTION_PASSES; pass += 1) {
      if (options.signal.aborted) break;
      const result = await host.channelTimelineEvict({
        touchedBeforeMs,
        maxChannels: MAX_EVICTED_CHANNELS,
      });
      if (result.kind === 'unsupported') break;
      evicted += result.channelIds.length;
      if (!result.hasMore) break;
    }
    span.setAttr('evict.channels', evicted);
    return evicted;
  });
}
