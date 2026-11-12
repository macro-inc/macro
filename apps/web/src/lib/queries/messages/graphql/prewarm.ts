import { useChannelsContext } from '@core/context/channels';
import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ApiActivity } from '@service-storage/generated/schemas/apiActivity';
import { makeEventListener } from '@solid-primitives/event-listener';
import { addDays, isBefore, isValid, parseISO, subDays } from 'date-fns';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { currentQueryAccount } from '../../auth/account-scope';
import { channelKeys } from '../../channel/keys';
import { queryClient } from '../../client';
import { messageKeys } from '../keys';
import { getMessageTimelineQueryKeyPrefix } from '../timeline';
import { applyChangesToLatestPage, trimLatestPage } from './apply';
import { CURSOR_PAGE_LIMIT, MAX_CATCH_UP_PAGES } from './channel-sync';
import { activityFromGraphql, entryFromGraphql } from './convert';
import {
  channelCacheHost,
  fetchChannelChanges,
  fetchLatestChannelPage,
  type LatestChannelPage,
  readCachedLatestPage,
  readCachedPageRecords,
  writeCachedLatestPage,
} from './source';

/** Recently opened channels warmed beside the unread ones. */
const RECENT_CHANNELS = 20;
/** A channel not opened for this long loses its cached page. */
const KEEP_OPENED_DAYS = 30;
/** Channels warmed together between idle moments. */
const CHANNELS_PER_STEP = 3;
/** Channels whose cached pages one idle moment looks up for eviction. */
const EVICT_CHANNELS_PER_STEP = 50;
/** Leave the first seconds to the landing view, as route warming does. */
const START_DELAY_MS = 2_500;
const IDLE_TIMEOUT_MS = 5_000;
const IDLE_FALLBACK_MS = 1_000;
const SURFACE = 'channel-prewarm';
/** Lists updated before this were restored from the device. */
const PAGE_LOADED_AT = performance.timeOrigin;

/** When the viewer last opened each channel, in epoch milliseconds. */
type LastOpened = ReadonlyMap<string, number>;

/** The viewer's channels and when each was last opened, from loaded lists. */
type KnownChannels = {
  channelIds: string[];
  lastOpened: LastOpened;
  /**
   * Both lists were read from the server since the page loaded, not only
   * restored from the device, where they can be a week old.
   */
  readThisLoad: boolean;
};

export type PrewarmOutcome =
  /** Its timeline is in TanStack Query; the channel's own sync writes its page. */
  | 'loaded'
  /** The cache held no page: the server's latest page was written. */
  | 'fetched'
  /** The cached page took the changes after its number and was written back. */
  | 'caught_up'
  /** The cached page was current; nothing was written. */
  | 'current'
  /** A reset or too many changes: the server's latest page replaced it. */
  | 'read_again'
  /** A read or the write failed; the cached page is as it was. */
  | 'failed'
  /** The channel opened or the session changed before the write. */
  | 'superseded';

type PrewarmSession = {
  host: CacheHost;
  userId: string;
  /** Channels warmed this session. One that turns unread again is warmed again. */
  warmed: Set<string>;
  /** The unread channels at the last run. */
  unread: ReadonlySet<string>;
  /** When the session next looks for pages to evict. */
  nextEviction: Date;
  running: Promise<void> | null;
  /** Unread channels a call during a run asked for: the run goes again. */
  pending: readonly string[] | null;
};

let session: PrewarmSession | undefined;

/**
 * Whether the channel's timeline is in TanStack Query: on screen, opening, or
 * kept after it closed. Its own sync owns the cached page meanwhile.
 */
function isChannelTimelineLoaded(channelId: string): boolean {
  return (
    queryClient.getQueryCache().findAll({
      queryKey: getMessageTimelineQueryKeyPrefix({
        type: 'channel',
        id: channelId,
      }),
    }).length > 0
  );
}

function sessionIsCurrent(current: PrewarmSession): boolean {
  return (
    session === current &&
    channelCacheHost() === current.host &&
    currentQueryAccount()?.userId === current.userId
  );
}

function canContinue(current: PrewarmSession): boolean {
  return sessionIsCurrent(current) && document.visibilityState === 'visible';
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
    } else {
      setTimeout(resolve, IDLE_FALLBACK_MS);
    }
  });
}

function timelineReadInFlight(): boolean {
  return queryClient.isFetching({ queryKey: messageKeys.messages._def }) > 0;
}

/** Resolves once no timeline read is in flight. */
function timelineReadsSettled(): Promise<void> {
  if (!timelineReadInFlight()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (timelineReadInFlight()) return;
      unsubscribe();
      resolve();
    });
  });
}

/** An idle moment with no timeline read in flight: an open goes first. */
async function nextQuietMoment(): Promise<void> {
  await idle();
  while (timelineReadInFlight()) {
    await timelineReadsSettled();
    await idle();
  }
}

function openedAt(viewedAt: string | null | undefined): number | undefined {
  if (!viewedAt) return undefined;
  const at = parseISO(viewedAt);
  return isValid(at) ? at.getTime() : undefined;
}

/**
 * The viewer's channels and when each was last opened, once both lists have
 * loaded for this account. Opening a channel moves its activity row's
 * `viewed_at` in place; the channel list carries the same time as of its read.
 */
function readKnownChannels(userId: string): KnownChannels | undefined {
  const list = queryClient.getQueryState<ApiChannelWithLatest[]>(
    channelKeys.listChannels(userId).queryKey
  );
  const activity = queryClient.getQueryState<ApiActivity[]>(
    channelKeys.activity(userId).queryKey
  );
  // Without both, every page would look unopened and be evicted.
  if (list?.status !== 'success' || activity?.status !== 'success') return;
  const channels = list.data ?? [];
  const lastOpened = new Map<string, number>();
  const opened = (channelId: string, viewedAt: string | null | undefined) => {
    const at = openedAt(viewedAt);
    if (at !== undefined && at > (lastOpened.get(channelId) ?? -Infinity)) {
      lastOpened.set(channelId, at);
    }
  };
  for (const channel of channels) opened(channel.id, channel.viewed_at);
  for (const row of activity.data ?? []) opened(row.channel_id, row.viewed_at);
  return {
    channelIds: channels.map((channel) => channel.id),
    lastOpened,
    readThisLoad:
      Math.min(list.dataUpdatedAt, activity.dataUpdatedAt) >= PAGE_LOADED_AT,
  };
}

/**
 * The channels to warm: every unread one, then the viewer's 20 most recently
 * opened, each once, leaving out those whose timeline is loaded.
 */
export function chooseChannelsToPrewarm({
  unread,
  channelIds,
  lastOpened,
  isLoaded,
}: {
  unread: readonly string[];
  channelIds: readonly string[];
  lastOpened: LastOpened;
  isLoaded: (channelId: string) => boolean;
}): string[] {
  const recent = channelIds
    .filter((channelId) => lastOpened.has(channelId))
    .sort((a, b) => (lastOpened.get(b) ?? 0) - (lastOpened.get(a) ?? 0))
    .slice(0, RECENT_CHANNELS);
  return [...new Set([...unread, ...recent])].filter(
    (channelId) => !isLoaded(channelId)
  );
}

/**
 * The cached page with every change after its number applied, or `undefined`
 * when the server says it must be read again: a reset, or more change pages
 * than an open would catch up.
 */
async function catchUpCachedPage(
  channelId: string,
  cached: LatestChannelPage,
  span: Span
): Promise<LatestChannelPage | undefined> {
  let latest = cached;
  for (let pages = 1; pages <= MAX_CATCH_UP_PAGES; pages += 1) {
    span.setAttr('channel.prewarm.change_pages', pages);
    const since = latest.seq;
    const changes = await span.run(() => fetchChannelChanges(channelId, since));
    if (changes.reset) return undefined;
    latest = {
      ...latest,
      seq: changes.seq,
      page: applyChangesToLatestPage(
        latest.page,
        {
          entries: changes.entries.map(entryFromGraphql),
          activities: changes.activities.map(activityFromGraphql),
          removed: new Set(changes.removed),
        },
        CURSOR_PAGE_LIMIT
      ),
    };
    if (!changes.hasMore) return latest;
  }
  return undefined;
}

type WarmRead =
  | {
      outcome: 'fetched' | 'caught_up' | 'read_again';
      latest: LatestChannelPage;
    }
  | { outcome: 'current' | 'failed' };

/** The page to write for the channel, from what the cache already holds. */
async function readWarmPage(
  host: CacheHost,
  channelId: string,
  span: Span
): Promise<WarmRead> {
  let cached: LatestChannelPage | undefined;
  try {
    cached = await readCachedLatestPage(host, channelId, 'background');
  } catch (error) {
    // A cache that cannot read the page is left as it is.
    span.error(error);
    return { outcome: 'failed' };
  }
  try {
    if (!cached) {
      const latest = await span.run(() => fetchLatestChannelPage(channelId));
      return { outcome: 'fetched', latest };
    }
    const caughtUp = await catchUpCachedPage(channelId, cached, span);
    if (caughtUp) {
      return caughtUp.seq === cached.seq
        ? { outcome: 'current' }
        : { outcome: 'caught_up', latest: caughtUp };
    }
    const latest = await span.run(() => fetchLatestChannelPage(channelId));
    return { outcome: 'read_again', latest };
  } catch (error) {
    span.error(error);
    return { outcome: 'failed' };
  }
}

async function warm(
  current: PrewarmSession,
  channelId: string,
  span: Span
): Promise<PrewarmOutcome> {
  if (isChannelTimelineLoaded(channelId)) return 'loaded';
  const read = await readWarmPage(current.host, channelId, span);
  if (!('latest' in read)) return read.outcome;
  // Opened meanwhile: its own sync writes the page it shows.
  if (!sessionIsCurrent(current) || isChannelTimelineLoaded(channelId)) {
    return 'superseded';
  }
  try {
    await writeCachedLatestPage(current.host, channelId, {
      ...read.latest,
      page: trimLatestPage(read.latest.page, CURSOR_PAGE_LIMIT),
    });
  } catch (error) {
    span.error(error);
    return 'failed';
  }
  return read.outcome;
}

async function warmChannel(
  current: PrewarmSession,
  channelId: string,
  span: Span
): Promise<PrewarmOutcome> {
  span.setAttr('channel.id', channelId);
  const outcome = await warm(current, channelId, span);
  span.setAttr('channel.prewarm.outcome', outcome);
  return outcome;
}

/** Warm the channels a few at a time, each step in an idle moment. */
async function prewarmChannels(
  current: PrewarmSession,
  channelIds: readonly string[]
): Promise<void> {
  if (channelIds.length === 0) return;
  await Telemetry.span('channel.prewarm', async (span) => {
    span.setAttr('channel.prewarm.channels', channelIds.length);
    const outcomes = new Map<PrewarmOutcome, number>();
    let stopped = false;
    try {
      for (
        let offset = 0;
        offset < channelIds.length;
        offset += CHANNELS_PER_STEP
      ) {
        await nextQuietMoment();
        if (!canContinue(current)) {
          stopped = true;
          return;
        }
        const step = channelIds.slice(offset, offset + CHANNELS_PER_STEP);
        const results = await Promise.all(
          step.map((channelId) =>
            span.span('channel.prewarm_page', (child) =>
              warmChannel(current, channelId, child)
            )
          )
        );
        results.forEach((outcome, index) => {
          outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
          // A failed one is tried again on the next run.
          if (
            outcome !== 'loaded' &&
            outcome !== 'superseded' &&
            outcome !== 'failed'
          ) {
            current.warmed.add(step[index]);
          }
        });
      }
    } finally {
      span.setAttr('channel.prewarm.stopped', stopped);
      for (const [outcome, count] of outcomes) {
        span.setAttr(`channel.prewarm.${outcome}`, count);
      }
    }
  });
}

/**
 * The channels whose cached pages go: known from the lists, not opened within
 * 30 days, and not about to be warmed.
 */
function staleChannels(
  known: KnownChannels,
  keep: ReadonlySet<string>,
  now: Date
): string[] {
  const cutoff = subDays(now, KEEP_OPENED_DAYS).getTime();
  const channelIds = new Set([...known.channelIds, ...known.lastOpened.keys()]);
  return [...channelIds].filter(
    (channelId) =>
      !keep.has(channelId) &&
      (known.lastOpened.get(channelId) ?? -Infinity) < cutoff
  );
}

/**
 * Delete the cached page and rows of every stale channel. Returns false when
 * it stopped before the end: the tab was hidden or the session changed.
 */
async function evictStaleChannelPages(
  current: PrewarmSession,
  known: KnownChannels,
  keep: ReadonlySet<string>,
  now: Date
): Promise<boolean> {
  return Telemetry.span('channel.cache_evict', async (span) => {
    const candidates = staleChannels(known, keep, now);
    span.setAttr('channel.cache_evict.candidates', candidates.length);
    let channels = 0;
    let records = 0;
    let finished = false;
    try {
      for (
        let offset = 0;
        offset < candidates.length;
        offset += EVICT_CHANNELS_PER_STEP
      ) {
        await nextQuietMoment();
        if (!canContinue(current)) return false;
        const pages = await readCachedPageRecords(
          current.host,
          candidates.slice(offset, offset + EVICT_CHANNELS_PER_STEP)
        );
        const keys: string[] = [];
        for (const [channelId, pageKeys] of pages) {
          // An open channel's sync writes its page again; leave it.
          if (isChannelTimelineLoaded(channelId)) continue;
          channels += 1;
          keys.push(...pageKeys);
        }
        if (keys.length > 0) await current.host.deleteRecords(keys);
        records += keys.length;
      }
      finished = true;
      return true;
    } finally {
      span.setAttr('channel.cache_evict.channels', channels);
      span.setAttr('channel.cache_evict.records', records);
      span.setAttr('channel.cache_evict.finished', finished);
    }
  });
}

async function runMaintenance(current: PrewarmSession): Promise<void> {
  while (current.pending && canContinue(current)) {
    const unread = current.pending;
    current.pending = null;
    const known = readKnownChannels(current.userId);
    if (!known) return;
    const unreadNow = new Set(unread);
    for (const channelId of unreadNow) {
      if (!current.unread.has(channelId)) current.warmed.delete(channelId);
    }
    current.unread = unreadNow;
    const chosen = chooseChannelsToPrewarm({
      unread,
      channelIds: known.channelIds,
      lastOpened: known.lastOpened,
      isLoaded: isChannelTimelineLoaded,
    });
    await prewarmChannels(
      current,
      chosen.filter((channelId) => !current.warmed.has(channelId))
    );
    const now = new Date();
    // A channel opened on another device since restored lists were read
    // would look unopened; evict only from lists read since the page loaded.
    if (
      !canContinue(current) ||
      !known.readThisLoad ||
      isBefore(now, current.nextEviction)
    ) {
      continue;
    }
    current.nextEviction = addDays(now, 1);
    const keep = new Set([...unread, ...chosen]);
    if (!(await evictStaleChannelPages(current, known, keep, now))) {
      current.nextEviction = now;
    }
  }
}

/**
 * Warm the channels the viewer is likely to open next and evict the pages of
 * channels not opened for 30 days: on the first run of each page load whose
 * lists came from the server, then at most once a day. Does nothing without
 * the channel cache, a signed-in account, or a visible tab. A call during a
 * run makes it go again with the latest unread channels.
 */
export function maintainChannelCache(
  unreadChannelIds: readonly string[]
): Promise<void> {
  const host = channelCacheHost();
  const account = currentQueryAccount();
  if (!host || !account || document.visibilityState !== 'visible') {
    return Promise.resolve();
  }
  if (session?.host !== host || session.userId !== account.userId) {
    session = {
      host,
      userId: account.userId,
      warmed: new Set(),
      unread: new Set(),
      nextEviction: new Date(0),
      running: null,
      pending: null,
    };
  }
  const current = session;
  current.pending = unreadChannelIds;
  if (current.running) return current.running;
  const running = (async () => {
    try {
      await runMaintenance(current);
    } finally {
      current.running = null;
    }
  })();
  current.running = running;
  return running;
}

/** Forget what was warmed; the next run starts a new session. */
export function resetChannelPrewarm() {
  session = undefined;
}

/**
 * Keep channel pages warm while the app is open: shortly after it starts, and
 * again when the unread channels, the channel list or the viewer's channel
 * activity change, or the tab is shown again.
 */
export function useChannelCachePrewarm(
  unreadChannelIds: Accessor<readonly string[]>
) {
  const { channels, activity } = useChannelsContext();
  const schedule = debounce(() => {
    if (document.visibilityState !== 'visible') return;
    fireAndForget(maintainChannelCache(unreadChannelIds()), SURFACE);
  }, START_DELAY_MS);
  createEffect(on([unreadChannelIds, channels, activity], () => schedule()));
  makeEventListener(document, 'visibilitychange', () => schedule());
  onCleanup(() => schedule.clear());
}
