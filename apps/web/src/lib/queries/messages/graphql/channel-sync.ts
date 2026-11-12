import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import { sleep } from '@core/util/sleep';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import type {
  MessageParent,
  MessageThread,
  MessageTimelineEntry,
} from '@service-storage/messages';
import { hashKey } from '@tanstack/solid-query';
import { withinCacheHeadStart } from '../../calendar/graphql/readiness';
import { queryClient } from '../../client';
import {
  normalizeChannelMessageSender,
  normalizeMessageTimelinePageSenders,
  normalizeThreadReplySender,
} from '../message-sender';
import {
  getThreadRepliesQueryKey,
  getThreadRepliesQueryKeyPrefix,
  setThreadRepliesData,
} from '../thread-replies';
import {
  getMessageTimelineQueryKey,
  getMessageTimelineQueryKeyPrefix,
  insertActivitiesIntoMessageTimeline,
  type LoadedTimelinePage,
  type MessageTimelineData,
  type MessageTimelinePageParam,
  restartPendingChannelTimeline,
  setMessageTimelineData,
} from '../timeline';
import {
  removeThreadReplies,
  removeTimelineMessages,
  trimLatestPage,
  upsertThreadReply,
  upsertTimelineEntries,
} from './apply';
import {
  activityFromGraphql,
  entryFromGraphql,
  messageFromGraphql,
} from './convert';
import {
  type ChannelChanges,
  channelCacheHost,
  fetchChannelChanges,
  fetchChannelPage,
  fetchLatestChannelPage,
  type LatestChannelPage,
  readCachedLatestPage,
  writeCachedLatestPage,
} from './source';

/**
 * How long the cache is waited on alone for a channel it is known to hold. It
 * answers in milliseconds unless the engine is busy. For any other channel
 * the read is most likely a miss, or the cache is still starting, so the
 * server is asked at once.
 */
const ANSWERED_CACHE_HEAD_START_MS = 2_000;
/** The page size the REST timeline reads behind a cursor, and the cached page's bound. */
const CURSOR_PAGE_LIMIT = 100;
const FIRST_PAGE_LIMIT = 50;
/** Change pages one catch-up reads before it gives up and reads the page again. */
const MAX_CATCH_UP_PAGES = 20;
const PERSIST_DELAY_MS = 1_000;
/** A changes read that has not answered by now is treated as failed. */
const CHANGES_TIMEOUT_MS = 15_000;
const SURFACE = 'channel-sync';

type ChannelSyncState = {
  /** The user record the cached page hangs off. */
  userId: string;
  /** The cached page is past the server's reset limit: read from the network. */
  skipCache: boolean;
  running: Promise<void> | null;
  /** A catch-up was asked for while one ran. */
  rerun: boolean;
  persist: ReturnType<typeof debounce> | null;
  /** Checks that a page read asked for by `readAgain` was not lost. */
  recover: ReturnType<typeof debounce> | null;
};

const STATES = new Map<string, ChannelSyncState>();
/**
 * Channels each cache is known to hold a page for, learned from reads and
 * writes this session. Only those wait on the cache alone.
 */
const CACHED_CHANNELS = new WeakMap<object, Set<string>>();

/** Records whether the cache holds a page for the channel. */
export function noteCachedPage(host: object, channelId: string, held: boolean) {
  const known = CACHED_CHANNELS.get(host) ?? new Set<string>();
  CACHED_CHANNELS.set(host, known);
  if (held) known.add(channelId);
  else known.delete(channelId);
}

function track(channelId: string, userId: string) {
  const state = STATES.get(channelId);
  if (state) {
    state.userId = userId;
    state.skipCache = false;
    return state;
  }
  const created: ChannelSyncState = {
    userId,
    skipCache: false,
    running: null,
    rerun: false,
    persist: null,
    recover: null,
  };
  STATES.set(channelId, created);
  return created;
}

/**
 * The sequence number the channel's loaded latest page is current to. It is
 * kept on the page, not beside it: a refetch that commits, a cancelled one
 * that reverts, and a rollback that restores a snapshot all move the rows
 * and the number together, so the number never claims rows that are gone.
 */
function timelineSeq(parent: MessageParent): number | undefined {
  const data = queryClient.getQueryData<MessageTimelineData>(
    getMessageTimelineQueryKey(parent, null)
  );
  if (!data || data.pageParams[0] != null) return undefined;
  return data.pages[0]?.channel_seq;
}

function setTimelineSeq(parent: MessageParent, seq: number) {
  queryClient.setQueryData<MessageTimelineData>(
    getMessageTimelineQueryKey(parent, null),
    (data) => {
      const first = data?.pages[0];
      if (!data || !first || data.pageParams[0] != null) return data;
      if (first.channel_seq === seq) return data;
      return {
        ...data,
        pages: [{ ...first, channel_seq: seq }, ...data.pages.slice(1)],
      };
    }
  );
}

/**
 * The loaded rows may no longer be the ones the number describes, so the
 * timeline gives the number up. Without one it is not caught up or written
 * to the cache; the next page read from the server brings a new one.
 */
function forgetTimelineSeq(parent: MessageParent) {
  queryClient.setQueryData<MessageTimelineData>(
    getMessageTimelineQueryKey(parent, null),
    (data) => {
      const first = data?.pages[0];
      if (!data || first?.channel_seq === undefined) return data;
      const { channel_seq: _seq, ...page } = first;
      return { ...data, pages: [page, ...data.pages.slice(1)] };
    }
  );
}

/** The server said no: the viewer cannot read this channel, or it is gone. */
function isRefusal(error: unknown): boolean {
  return (
    thrownResultErrorHasCode(error, 'FORBIDDEN') ||
    thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
    thrownResultErrorHasCode(error, 'NOT_FOUND')
  );
}

/** The sequence number a channel's loaded timeline is current to, if it has one. */
export function channelSyncSeq(channelId: string): number | undefined {
  return timelineSeq({ type: 'channel', id: channelId });
}

/**
 * The cache host of a channel whose loaded timeline follows the change
 * sequence: it was read with a sequence number and its latest page is loaded.
 */
function trackedHost(parent: MessageParent): CacheHost | undefined {
  if (parent.type !== 'channel' || !STATES.has(parent.id)) return undefined;
  if (timelineSeq(parent) === undefined) return undefined;
  return channelCacheHost();
}

/**
 * Whether the channel's loaded timeline is kept current by its change
 * sequence. Such a timeline is never marked stale or read again to pick up a
 * change: what it lacks is exactly the changes after its sequence number.
 */
export function isChannelTracked(parent: MessageParent): boolean {
  return trackedHost(parent) !== undefined;
}

/**
 * Bring a tracked channel current from the server's changes. Returns false
 * for a parent that is not tracked, which the caller reads again instead.
 */
export function catchUpTrackedChannel(parent: MessageParent): boolean {
  const host = trackedHost(parent);
  if (!host) return false;
  fireAndForget(catchUpChannel(host, parent), SURFACE);
  return true;
}

/** Where a pushed change's sequence number falls for the loaded timeline. */
export type ChannelEventAdmission =
  /** The timeline does not follow the sequence; the event applies as before. */
  | 'untracked'
  /** The change right after the timeline's own: apply it. */
  | 'next'
  /** Already in the timeline, from a page or a catch-up. */
  | 'duplicate'
  /** Changes between are missing; only a catch-up can bring them. */
  | 'gap';

export function admitChannelEvent(
  parent: MessageParent,
  seq: number | null | undefined
): ChannelEventAdmission {
  const current = timelineSeq(parent);
  if (typeof seq !== 'number' || current === undefined || !trackedHost(parent))
    return 'untracked';
  if (seq <= current) return 'duplicate';
  return seq === current + 1 ? 'next' : 'gap';
}

/** The timeline now holds the pushed change numbered `seq`. */
export function channelEventApplied(parent: MessageParent, seq: number) {
  const host = trackedHost(parent);
  if (!host || seq - 1 !== timelineSeq(parent)) return;
  setTimelineSeq(parent, seq);
  schedulePersist(host, parent);
}

/**
 * A message write failed and its optimistic change was rolled back. The
 * server may have committed it all the same, and its pushed echo may already
 * have moved the timeline past it, so the rows are read again; asking for
 * the changes after the timeline's number would not bring it.
 */
export function reconcileFailedChannelWrite(parent: MessageParent) {
  if (trackedHost(parent)) readAgain(parent);
}

const WRITE_STARTS = new WeakMap<object, number | undefined>();

/**
 * Whether the channel's timeline was read through the device cache, with or
 * without a number at the moment.
 */
export function isChannelSequenced(parent: MessageParent): boolean {
  return (
    parent.type === 'channel' &&
    STATES.has(parent.id) &&
    channelCacheHost() !== undefined
  );
}

/** A write is starting: remember the number the timeline is at. */
export function channelWriteStarted(parent: MessageParent, write: object) {
  WRITE_STARTS.set(write, timelineSeq(parent));
}

/**
 * Whether a write's response may still be put into the timeline. Once the
 * number has moved, the timeline holds changes the response may predate: a
 * response applied then would put an older row under a newer number, which
 * no catch-up corrects. The write's own change has arrived by its number, or
 * will.
 */
export function channelWriteResponseApplies(
  parent: MessageParent,
  write: object
): boolean {
  if (!WRITE_STARTS.has(write) || !trackedHost(parent)) return true;
  return WRITE_STARTS.get(write) === timelineSeq(parent);
}

/** Forget every channel's position; the next open reads its page again. */
export function resetChannelSync() {
  for (const state of STATES.values()) {
    state.persist?.clear();
    state.recover?.clear();
  }
  STATES.clear();
}

type CachedLatestPage = NonNullable<
  Awaited<ReturnType<typeof readCachedLatestPage>>
>;

/** The cached page once the cache answers; a miss or an unreadable cache is `undefined`. */
async function readCache(
  host: CacheHost,
  channelId: string
): Promise<CachedLatestPage | undefined> {
  try {
    const page = await readCachedLatestPage(host, channelId);
    const held = page && page.page.entries.length > 0 ? page : undefined;
    noteCachedPage(host, channelId, held !== undefined);
    return held;
  } catch {
    // An unreadable cache is a miss: the network read replaces what it holds.
    return undefined;
  }
}

/**
 * Empty the channel's cached page. An empty page reads as a miss, so the
 * next open asks the server.
 */
async function dropCachedPage(host: CacheHost, channelId: string) {
  const cached = await readCache(host, channelId);
  if (!cached || channelCacheHost() !== host) return;
  await writeCachedLatestPage(host, channelId, {
    ...cached,
    page: { ...cached.page, entries: [] },
  });
  noteCachedPage(host, channelId, false);
}

type LatestPageRead =
  | { source: 'cache'; read: CachedLatestPage }
  | { source: 'network'; read: LatestChannelPage };

/**
 * The server's page, unless the cache answers with one first. A slow or
 * starting cache loses to a fast network and wins on a slow or absent one.
 */
async function raceCacheWithNetwork(
  host: CacheHost,
  cache: Promise<CachedLatestPage | undefined>,
  channelId: string,
  signal?: AbortSignal
): Promise<LatestPageRead> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const network = fetchLatestChannelPage(channelId, controller.signal);
  const fromNetwork = async (): Promise<LatestPageRead> => {
    try {
      return { source: 'network', read: await network };
    } catch (error) {
      // A refusal is the server's answer: someone removed from a channel
      // must not be shown its cached page, now or on the next open.
      if (isRefusal(error)) {
        fireAndForget(dropCachedPage(host, channelId), SURFACE);
        throw error;
      }
      // Offline or failing: the cached page is still better than nothing.
      const cached = await cache;
      if (!cached || signal?.aborted) throw error;
      return { source: 'cache', read: cached };
    }
  };
  const fromCache = async (): Promise<LatestPageRead> => {
    const cached = await cache;
    return cached ? { source: 'cache', read: cached } : fromNetwork();
  };
  try {
    const winner = await Promise.race([fromCache(), fromNetwork()]);
    // The cached page is on screen; its catch-up brings what the server has.
    if (winner.source === 'cache') controller.abort();
    return winner;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

async function readLatestPage(
  host: CacheHost,
  parent: MessageParent,
  signal?: AbortSignal
): Promise<LatestPageRead & { raced: boolean }> {
  const loaded = queryClient.getQueryData<MessageTimelineData>(
    getMessageTimelineQueryKey(parent, null)
  );
  // A timeline already on screen is being read again because it may be
  // wrong, so only the server's page will do.
  const state = STATES.get(parent.id);
  if (loaded || state?.skipCache) {
    try {
      const read = await fetchLatestChannelPage(parent.id, signal);
      return { source: 'network', read, raced: false };
    } catch (error) {
      // Rows on screen would stay there over a failed refetch; a refusal
      // has to take them, and the cached page, away.
      if (loaded && state && isRefusal(error)) {
        dropRefusedChannel(host, parent, state);
      }
      throw error;
    }
  }
  const cache = readCache(host, parent.id);
  const early = CACHED_CHANNELS.get(host)?.has(parent.id)
    ? await withinCacheHeadStart(cache, ANSWERED_CACHE_HEAD_START_MS)
    : 'not-ready';
  signal?.throwIfAborted();
  if (early === 'not-ready') {
    const winner = await raceCacheWithNetwork(host, cache, parent.id, signal);
    return { ...winner, raced: true };
  }
  if (early) return { source: 'cache', read: early, raced: false };
  const read = await fetchLatestChannelPage(parent.id, signal);
  return { source: 'network', read, raced: false };
}

async function loadLatestPage(
  host: CacheHost,
  parent: MessageParent,
  signal?: AbortSignal
): Promise<LoadedTimelinePage> {
  return Telemetry.span('channel.timeline_load', async (span) => {
    span.setAttr('channel.id', parent.id);
    const { source, read, raced } = await readLatestPage(host, parent, signal);
    signal?.throwIfAborted();
    span.setAttr('channel.timeline.source', source);
    span.setAttr('channel.timeline.cache_raced', raced);
    span.setAttr('channel.timeline.entries', read.page.entries.length);
    track(parent.id, read.userId);
    if (source === 'cache') {
      fireAndForget(catchUpChannel(host, parent), SURFACE);
    } else {
      // The server's page reaches the cache once it is on screen.
      schedulePersist(host, parent);
    }
    return {
      ...normalizeMessageTimelinePageSenders(read.page),
      channel_seq: read.seq,
    };
  });
}

/**
 * One page of a channel's timeline. The latest page opens from the device
 * cache and is brought current with the changes after its sequence number;
 * pages behind a cursor or around a message come from the server.
 */
export async function loadChannelTimelinePage(
  host: CacheHost,
  parent: MessageParent,
  pageParam: MessageTimelinePageParam | null,
  loadAroundMessageId: string | null,
  signal?: AbortSignal
): Promise<LoadedTimelinePage> {
  const cursor = pageParam?.next_cursor ?? pageParam?.previous_cursor;
  if (pageParam && cursor) {
    const read = await fetchChannelPage(
      parent.id,
      { cursor, direction: pageParam.previous_cursor ? 'newer' : 'older' },
      CURSOR_PAGE_LIMIT,
      signal
    );
    return normalizeMessageTimelinePageSenders(read.page);
  }
  if (loadAroundMessageId) {
    const read = await fetchChannelPage(
      parent.id,
      { around: loadAroundMessageId },
      FIRST_PAGE_LIMIT,
      signal
    );
    return normalizeMessageTimelinePageSenders(read.page);
  }
  return loadLatestPage(host, parent, signal);
}

function normalizeEntry(entry: MessageTimelineEntry): MessageTimelineEntry {
  return entry.type === 'message'
    ? { ...entry, message: normalizeChannelMessageSender(entry.message) }
    : entry;
}

/** Put one page of changes into every loaded view of the channel. */
function applyChannelChanges(parent: MessageParent, changes: ChannelChanges) {
  const entries = changes.entries.map(entryFromGraphql).map(normalizeEntry);
  const activities = changes.activities.map(activityFromGraphql);
  const removed = new Set(changes.removed);
  if (entries.length > 0 || activities.length > 0 || removed.size > 0) {
    setMessageTimelineData(parent, (data) =>
      removeTimelineMessages(
        insertActivitiesIntoMessageTimeline(
          upsertTimelineEntries(data, entries),
          activities
        ),
        removed
      )
    );
  }
  for (const entry of entries) {
    if (entry.type === 'activity') continue;
    // A loaded thread shows its own copy of the root and its state.
    const { state, thread: _summary, ...root } = entry.message;
    queryClient.setQueryData<MessageThread>(
      getThreadRepliesQueryKey(parent, root.id),
      (thread) => thread && { ...thread, root, state }
    );
  }
  const unloadedThreads = new Set<string>();
  for (const reply of changes.replies) {
    const message = normalizeThreadReplySender(messageFromGraphql(reply));
    if (!message.thread_id) continue;
    const threadId = message.thread_id;
    const loaded = setThreadRepliesData(parent, threadId, (replies) =>
      upsertThreadReply(replies, message)
    );
    if (!loaded) unloadedThreads.add(threadId);
  }
  for (const threadId of unloadedThreads) {
    // A thread being read for the first time may have been answered before
    // this reply existed. The reply as it is now may be older than what that
    // read returns, so the thread is read once more instead of patched.
    const queryKey = getThreadRepliesQueryKey(parent, threadId);
    const firstRead = queryClient
      .getQueryCache()
      .find<MessageThread>({ queryKey, exact: true })?.promise;
    if (!firstRead) continue;
    fireAndForget(
      (async () => {
        try {
          await firstRead;
        } catch {
          return;
        }
        await queryClient.invalidateQueries({ queryKey, exact: true });
      })(),
      SURFACE
    );
  }
  if (removed.size > 0) removeThreadReplies(parent, removed);
}

/**
 * Whether the latest page reached the timeline. A catch-up starts inside the
 * read that returns the cached page, before the timeline holds it, and
 * changes applied to a timeline that is not there yet would be lost.
 */
function latestPageLoaded(parent: MessageParent): Promise<boolean> {
  const queryKey = getMessageTimelineQueryKey(parent, null);
  if (queryClient.getQueryData(queryKey)) return Promise.resolve(true);
  const queryHash = hashKey(queryKey);
  return new Promise((resolve) => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash !== queryHash) return;
      const { data, fetchStatus } = event.query.state;
      const loaded = data !== undefined;
      // A read that ended without a page (cancelled, failed, removed) never
      // brings one.
      if (!loaded && event.type !== 'removed' && fetchStatus !== 'idle') return;
      unsubscribe();
      resolve(loaded);
    });
  });
}

/**
 * Read the channel's pages from the server again. The rows on screen are in
 * doubt until that read lands, so they give up their sequence number first.
 */
function readAgain(parent: MessageParent) {
  forgetTimelineSeq(parent);
  invalidatePages(parent);
  scheduleRecover(parent);
}

function invalidatePages(parent: MessageParent) {
  queryClient.invalidateQueries({
    queryKey: getMessageTimelineQueryKeyPrefix(parent),
  });
  queryClient.invalidateQueries({
    queryKey: getThreadRepliesQueryKeyPrefix(parent),
  });
}

/**
 * An optimistic write cancels a page read in flight and clears the mark that
 * would start another, which would leave the timeline without a number for
 * good. Once the channel is quiet, ask for the read again if it never landed.
 */
function recoverLostRead(parent: MessageParent) {
  const key = getMessageTimelineQueryKey(parent, null);
  const data = queryClient.getQueryData<MessageTimelineData>(key);
  if (!data || data.pageParams[0] != null) return;
  if (data.pages[0]?.channel_seq !== undefined || !channelCacheHost()) return;
  const query = queryClient.getQueryState(key);
  // A read in flight or waiting for the connection may still be cancelled by
  // the next write, so look again until the number is back.
  if (query?.fetchStatus !== 'idle' || hasPendingWrite(parent.id)) {
    scheduleRecover(parent);
    return;
  }
  // A read the server failed is not asked for in a loop: a reconnect or the
  // next open reads the channel again.
  if (query.status === 'error') return;
  invalidatePages(parent);
  scheduleRecover(parent);
}

function scheduleRecover(parent: MessageParent) {
  const state = STATES.get(parent.id);
  if (!state) return;
  state.recover ??= debounce(
    (recoverParent: MessageParent) => recoverLostRead(recoverParent),
    PERSIST_DELAY_MS
  );
  state.recover(parent);
}

/**
 * The server refused the channel's changes to a timeline shown from the
 * cache. Drop the cached page and the loaded rows, so the read that follows
 * shows the refusal instead of the page.
 */
function dropRefusedChannel(
  host: CacheHost,
  parent: MessageParent,
  state: ChannelSyncState
) {
  state.skipCache = true;
  fireAndForget(dropCachedPage(host, parent.id), SURFACE);
  queryClient.resetQueries({
    queryKey: getMessageTimelineQueryKeyPrefix(parent),
  });
}

async function readChanges(
  channelId: string,
  since: number
): Promise<ChannelChanges> {
  const changes = await Promise.race([
    fetchChannelChanges(channelId, since),
    sleep(CHANGES_TIMEOUT_MS),
  ]);
  if (!changes) throw new Error('Channel changes read timed out');
  return changes;
}

async function runCatchUp(
  host: CacheHost,
  parent: MessageParent,
  state: ChannelSyncState
) {
  await Telemetry.span('channel.catch_up', async (span) => {
    span.setAttr('channel.id', parent.id);
    let pages = 0;
    let rows = 0;
    let outcome = 'current';
    try {
      if (!(await latestPageLoaded(parent))) {
        outcome = 'unloaded';
        return;
      }
      span.setAttr('channel.catch_up.since', timelineSeq(parent) ?? -1);
      for (;;) {
        state.rerun = false;
        let applied = 0;
        let more = true;
        while (more) {
          if (pages >= MAX_CATCH_UP_PAGES) {
            outcome = 'too_far_behind';
            readAgain(parent);
            return;
          }
          pages += 1;
          const since = timelineSeq(parent);
          // The loaded page was not read with a sequence number, or is gone.
          if (since === undefined) {
            outcome = 'unloaded';
            return;
          }
          const changes = await readChanges(parent.id, since);
          const current = timelineSeq(parent);
          if (current !== since) {
            // A page read, a pushed change, a cancelled refetch or a rollback
            // moved the timeline meanwhile. One already at the server's
            // number holds these changes; any other asks again from where
            // it is now.
            if (!changes.reset && current !== undefined)
              more = current < changes.seq;
            continue;
          }
          if (changes.reset) {
            outcome = 'reset';
            state.skipCache = true;
            readAgain(parent);
            return;
          }
          applyChannelChanges(parent, changes);
          setTimelineSeq(parent, changes.seq);
          applied +=
            changes.entries.length +
            changes.replies.length +
            changes.activities.length +
            changes.removed.length;
          more = changes.hasMore;
        }
        rows += applied;
        // A page read that started before these changes would commit over
        // them; start it again so it reads from the timeline as it is now.
        if (applied > 0) await restartPendingChannelTimeline(parent);
        // A catch-up asked for during that restart is still owed.
        if (!state.rerun) break;
      }
      if (rows > 0) outcome = 'applied';
      schedulePersist(host, parent);
    } catch (error) {
      if (isRefusal(error)) {
        outcome = 'refused';
        dropRefusedChannel(host, parent, state);
        return;
      }
      outcome = 'failed';
      // The cached page may be behind; the server's page settles it, and
      // its failure is the timeline's to show.
      readAgain(parent);
      throw error;
    } finally {
      span.setAttr('channel.catch_up.pages', pages);
      span.setAttr('channel.catch_up.rows', rows);
      span.setAttr('channel.catch_up.outcome', outcome);
    }
  });
}

/**
 * Bring a tracked channel's timeline current with the changes after its
 * sequence number. One runs per channel; a call during a run makes it ask
 * once more before it ends.
 */
export function catchUpChannel(
  host: CacheHost,
  parent: MessageParent
): Promise<void> {
  const state = STATES.get(parent.id);
  if (!state) return Promise.resolve();
  if (state.running) {
    state.rerun = true;
    return state.running;
  }
  const running = (async () => {
    try {
      await runCatchUp(host, parent, state);
    } finally {
      state.running = null;
    }
  })();
  state.running = running;
  return running;
}

function hasPendingWrite(channelId: string): boolean {
  return queryClient
    .getMutationCache()
    .findAll({ status: 'pending' })
    .some((mutation) => {
      const variables: unknown = mutation.state.variables;
      if (typeof variables !== 'object' || variables === null) return false;
      const parent: unknown = Reflect.get(variables, 'parent');
      return (
        typeof parent === 'object' &&
        parent !== null &&
        Reflect.get(parent, 'id') === channelId
      );
    });
}

async function persistLatestPage(host: CacheHost, parent: MessageParent) {
  const state = STATES.get(parent.id);
  if (!state) return;
  const data = queryClient.getQueryData<MessageTimelineData>(
    getMessageTimelineQueryKey(parent, null)
  );
  const latest = data?.pages[0];
  // Only a page at the live edge is the channel's latest page.
  if (!data || !latest || data.pageParams[0] != null || latest.previous_cursor)
    return;
  // A page read without a sequence number cannot be caught up later, and a
  // cache that is no longer the session's is not this page's to write.
  const seq = latest.channel_seq;
  if (seq === undefined || channelCacheHost() !== host) return;
  // An optimistic row is not the server's; wait for its write to settle.
  if (hasPendingWrite(parent.id)) {
    schedulePersist(host, parent);
    return;
  }
  await writeCachedLatestPage(host, parent.id, {
    seq,
    userId: state.userId,
    page: trimLatestPage(latest, CURSOR_PAGE_LIMIT),
  });
  noteCachedPage(host, parent.id, true);
}

/** Write the loaded latest page back to the cache once the timeline is quiet. */
function schedulePersist(host: CacheHost, parent: MessageParent) {
  const state = STATES.get(parent.id);
  if (!state) return;
  state.persist ??= debounce(
    (persistHost: CacheHost, persistParent: MessageParent) =>
      fireAndForget(persistLatestPage(persistHost, persistParent), SURFACE),
    PERSIST_DELAY_MS
  );
  state.persist(host, parent);
}
