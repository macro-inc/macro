import type { CacheHost } from '@graphql-cache/index';
import { MAX_EVICTED_CHANNELS } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import type { ApiChannelWithLatest } from '@service-storage/generated/schemas/apiChannelWithLatest';
import { catchUpAndRefresh, type FetchChannelChanges } from './catch-up';
import { type FetchChannelServerPage, loadChannelPage } from './pages';

/** Recently used channels kept ready on the device, besides unread ones. */
export const PREWARM_RECENT_CHANNELS = 20;
/** Bound on unread channels warmed in one pass, newest message first. */
export const PREWARM_UNREAD_CHANNELS = 50;
/** The page a channel opens with. */
const PREWARM_PAGE_SIZE = 50;
const CHANNEL_DELAY_MS = 500;
/** Channels not opened for this long leave the device. */
export const CHANNEL_EVICTION_AGE_MS = 30 * 86_400_000;
const MAX_EVICTION_PASSES = 10;

type PrewarmChannel = Pick<
  ApiChannelWithLatest,
  | 'id'
  | 'is_participant'
  | 'viewed_at'
  | 'interacted_at'
  | 'latest_non_thread_message'
>;

const time = (value: string | null | undefined) =>
  value ? Date.parse(value) || 0 : 0;

const lastUsed = (channel: PrewarmChannel) =>
  Math.max(time(channel.viewed_at), time(channel.interacted_at));

const latestMessage = (channel: PrewarmChannel) =>
  time(channel.latest_non_thread_message?.created_at);

/**
 * The channels to keep ready, in warming order: those with a message newer
 * than the viewer's last visit (newest first), then the most recently used.
 */
export function prewarmChannelIds(channels: PrewarmChannel[]): string[] {
  const joined = channels.filter((channel) => channel.is_participant);
  const unread = joined
    .filter((channel) => latestMessage(channel) > time(channel.viewed_at))
    .sort((a, b) => latestMessage(b) - latestMessage(a))
    .slice(0, PREWARM_UNREAD_CHANNELS);
  const recent = joined
    .filter((channel) => lastUsed(channel) > 0)
    .sort((a, b) => lastUsed(b) - lastUsed(a))
    .slice(0, PREWARM_RECENT_CHANNELS);
  return [...new Set([...unread, ...recent].map((channel) => channel.id))];
}

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
 * One channel failing does not stop the rest.
 */
export async function runChannelPrewarm(
  host: ChannelPrewarmHost,
  channelIds: string[],
  options: {
    signal: AbortSignal;
    delayMs?: number;
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
      if (signal.aborted) break;
      try {
        const loaded = await loadChannelPage(
          host,
          { channelId, limit: PREWARM_PAGE_SIZE },
          {
            signal,
            fetchPage: options.fetchPage,
            now: options.now,
            background: true,
          }
        );
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
