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
import { CURSOR_PAGE_LIMIT } from './channel-sync';
import { activityFromGraphql, entryFromGraphql } from './convert';
import {
  queueHoldsChannelWrite,
  restoreQueuedChannelWrites,
} from './queued-writes';
import {
  channelCacheHost,
  fetchChannelChanges,
  fetchLatestChannelPage,
  type LatestChannelPage,
  readCachedLatestPage,
  readCachedPageRecords,
  writeCachedLatestPage,
} from './source';

/** Unread channels warmed, most recently active first. */
const UNREAD_CHANNELS = 40;
/** Recently opened channels warmed beside the unread ones. */
const RECENT_CHANNELS = 20;
/**
 * Change pages a warm reads before it reads the latest page instead, so a
 * channel costs three requests at most.
 */
const PREWARM_CHANGE_PAGES = 2;
/** A server read with no answer by now fails its channel; the run goes on. */
const SERVER_READ_TIMEOUT_MS = 15_000;
/** The least time between two channels: 120 channels a minute at most. */
const CHANNEL_SPACING_MS = 500;
/** Warming waits this long after the person last pressed, typed or scrolled. */
const INPUT_QUIET_MS = 1_000;
/** How long warming waits on a timeline read before going on beside it. */
const READ_WAIT_MS = 30_000;
/** A channel not opened for this long loses its cached page. */
const KEEP_OPENED_DAYS = 30;
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
  | 'superseded'
  /**
   * The queue holds a write to the channel, whose response could land on the
   * page under a newer number; the next run warms it.
   */
  | 'write_queued';

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
  /** What a call during a run asked for: the run goes again. */
  pending: PrewarmRequest | null;
};

/** Both in the server's order: what the viewer is likeliest to open next. */
type PrewarmRequest = {
  /** Channels with unread messages, most recently active first. */
  unread: readonly string[];
  /** Channels the viewer opened, most recently opened first. */
  recent: readonly string[];
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The read's answer, or a failure once it has taken too long to give one. */
async function answered<T extends object>(read: Promise<T>): Promise<T> {
  const answer = await Promise.race([read, sleep(SERVER_READ_TIMEOUT_MS)]);
  if (!answer) throw new Error('Channel prewarm read timed out');
  return answer;
}

let lastInputAt = -Infinity;

/** The person pressed, typed or scrolled: warming waits for them to stop. */
function noteInput() {
  lastInputAt = performance.now();
}

function timelineReadInFlight(): boolean {
  return queryClient.isFetching({ queryKey: messageKeys.messages._def }) > 0;
}

/**
 * Resolves once no timeline read is in flight, or after `READ_WAIT_MS`: a
 * read that never settles must not park warming for the session.
 */
async function timelineReadsSettled(): Promise<void> {
  if (!timelineReadInFlight()) return;
  let unsubscribe = () => {};
  const settled = new Promise<void>((resolve) => {
    unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (!timelineReadInFlight()) resolve();
    });
  });
  await Promise.race([settled, sleep(READ_WAIT_MS)]);
  unsubscribe();
}

/**
 * An idle moment with no timeline read in flight and no recent input: an open
 * and whatever the person is doing go first.
 */
async function nextQuietMoment(): Promise<void> {
  await idle();
  for (;;) {
    const quietFor = performance.now() - lastInputAt;
    if (quietFor < INPUT_QUIET_MS) {
      await sleep(INPUT_QUIET_MS - quietFor);
    } else if (timelineReadInFlight()) {
      await timelineReadsSettled();
      // Still reading after the wait: go on beside it.
      if (timelineReadInFlight()) return;
    } else {
      return;
    }
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
 * The channels to warm: the first 40 unread, then the first 20 recently
 * opened, each once, leaving out those whose timeline is loaded. Both lists
 * arrive in the server's order, so the head of each is the likeliest to open.
 */
export function chooseChannelsToPrewarm({
  unread,
  recent,
  isLoaded,
}: PrewarmRequest & {
  isLoaded: (channelId: string) => boolean;
}): string[] {
  return [
    ...new Set([
      ...unread.slice(0, UNREAD_CHANNELS),
      ...recent.slice(0, RECENT_CHANNELS),
    ]),
  ].filter((channelId) => !isLoaded(channelId));
}

/**
 * The cached page with every change after its number applied, or `undefined`
 * when it must be read again: a reset, or more change pages than one
 * read of the latest page is worth.
 */
async function catchUpCachedPage(
  channelId: string,
  cached: LatestChannelPage,
  span: Span
): Promise<LatestChannelPage | undefined> {
  let latest = cached;
  for (let pages = 1; pages <= PREWARM_CHANGE_PAGES; pages += 1) {
    span.setAttr('channel.prewarm.change_pages', pages);
    const since = latest.seq;
    const changes = await span.run(() =>
      answered(fetchChannelChanges(channelId, since))
    );
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
    // An emptied page marks a refused channel: its number and cursor
    // describe rows that are gone, so it is read whole like a miss.
    if (!cached || cached.page.entries.length === 0) {
      const latest = await span.run(() =>
        answered(fetchLatestChannelPage(channelId))
      );
      return { outcome: 'fetched', latest };
    }
    const caughtUp = await catchUpCachedPage(channelId, cached, span);
    if (caughtUp) {
      return caughtUp.seq === cached.seq
        ? { outcome: 'current' }
        : { outcome: 'caught_up', latest: caughtUp };
    }
    const latest = await span.run(() =>
      answered(fetchLatestChannelPage(channelId))
    );
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
    // Read after the page, so a write it does not list commits after it.
    if (await queueHoldsChannelWrite(current.host, channelId))
      return 'write_queued';
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

/** Warm the channels one at a time, each in a quiet moment. */
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
      for (const [index, channelId] of channelIds.entries()) {
        if (index > 0) await sleep(CHANNEL_SPACING_MS);
        await nextQuietMoment();
        if (!canContinue(current)) {
          stopped = true;
          return;
        }
        const outcome = await span.span('channel.prewarm_page', (child) =>
          warmChannel(current, channelId, child)
        );
        outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
        // A failed one is tried again on the next run.
        if (
          outcome !== 'loaded' &&
          outcome !== 'superseded' &&
          outcome !== 'failed' &&
          outcome !== 'write_queued'
        ) {
          current.warmed.add(channelId);
        }
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
    const request = current.pending;
    current.pending = null;
    const chosen = chooseChannelsToPrewarm({
      ...request,
      isLoaded: isChannelTimelineLoaded,
    });
    const unreadNow = new Set(request.unread);
    for (const channelId of unreadNow) {
      if (!current.unread.has(channelId)) current.warmed.delete(channelId);
    }
    current.unread = unreadNow;
    await prewarmChannels(
      current,
      chosen.filter((channelId) => !current.warmed.has(channelId))
    );
    const now = new Date();
    const known = readKnownChannels(current.userId);
    // A channel opened on another device since restored lists were read
    // would look unopened; evict only from lists read since the page loaded.
    if (
      !known?.readThisLoad ||
      !canContinue(current) ||
      isBefore(now, current.nextEviction)
    ) {
      continue;
    }
    current.nextEviction = addDays(now, 1);
    const keep = new Set([...request.unread, ...chosen]);
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
 * run makes it go again with the latest channels.
 */
export function maintainChannelCache(request: PrewarmRequest): Promise<void> {
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
  current.pending = request;
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
 * activity change, or the tab is shown again. One request is in flight at a
 * time, and none while the person is pressing, typing or scrolling.
 */
export function useChannelCachePrewarm(
  unreadChannelIds: Accessor<readonly string[]>,
  recentChannelIds: Accessor<readonly string[]>
) {
  const { channels, activity } = useChannelsContext();
  // The queue sends without a channel being open; a post it holds from before
  // a reload needs someone on this page to take its text if it is refused.
  // Asked again on every run: the flag or the cache can arrive after mount,
  // and the read happens once per host.
  const readQueue = () => {
    const host = channelCacheHost();
    if (host) fireAndForget(restoreQueuedChannelWrites(host), SURFACE);
  };
  readQueue();
  const schedule = debounce(() => {
    readQueue();
    if (document.visibilityState !== 'visible') return;
    fireAndForget(
      maintainChannelCache({
        unread: unreadChannelIds(),
        recent: recentChannelIds(),
      }),
      SURFACE
    );
  }, START_DELAY_MS);
  createEffect(
    on([unreadChannelIds, recentChannelIds, channels, activity], () =>
      schedule()
    )
  );
  makeEventListener(document, 'visibilitychange', () => schedule());
  for (const input of ['pointerdown', 'keydown', 'wheel'] as const) {
    makeEventListener(document, input, noteInput, {
      capture: true,
      passive: true,
    });
  }
  onCleanup(() => schedule.clear());
}
