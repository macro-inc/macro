import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import type {
  MessageCursor,
  MessageThread,
  MessageTimelinePage,
} from '@service-storage/messages';
import { onlineManager } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import {
  catchUpAndRefresh,
  catchUpChannel,
  MAX_PUSH_REREADS,
  pushesStored,
  refreshChannelViews,
} from './catch-up';
import { channelCacheAnswered, channelCacheHost } from './flag';
import {
  type ChannelPageRequest,
  type LoadedChannelPage,
  loadChannelPage,
  pageHasPendingWrites,
} from './pages';
import { PREWARM_PAGE_SIZE } from './prewarm';
import { pageLacksQueuedSends, withQueuedSends } from './queued-sends';
import { sortKeyFromCursor } from './sort-key';
import { loadChannelMessage, loadChannelThread } from './thread';
import {
  forgetUnheldRead,
  noteUnheldRead,
  type UnheldRead,
  unheldReadsLeft,
} from './unheld-reads';
import {
  listQueuedReplies,
  pageHasQueuedReplies,
  withUnsettledThreadReplies,
} from './unsettled-replies';
import { watchWaitingWrites } from './waiting-writes';

const SYNC_SURFACE = 'channel-local-sync';

export interface ChannelTimelinePageRead {
  channelId: string;
  limit: number;
  /** Entries strictly older than this cursor. */
  older?: MessageCursor | null;
  /** Entries strictly newer than this cursor. */
  newer?: MessageCursor | null;
  aroundMessageId?: string | null;
  /**
   * The views already show this channel: bring the device up to date before
   * reading, so the read cannot put older state back.
   */
  revalidate?: boolean;
  signal?: AbortSignal;
}

function pageRequest(
  read: ChannelTimelinePageRead
): ChannelPageRequest | undefined {
  const before = read.older ? sortKeyFromCursor(read.older) : undefined;
  const after = read.newer ? sortKeyFromCursor(read.newer) : undefined;
  if ((read.older && !before) || (read.newer && !after)) return undefined;
  return {
    channelId: read.channelId,
    limit: read.limit,
    ...(before !== undefined && { before }),
    ...(after !== undefined && before === undefined && { after }),
    ...(before === undefined &&
      after === undefined &&
      read.aroundMessageId && { aroundMessageId: read.aroundMessageId }),
  };
}

/** Reports a device read that failed; offline, a read the device cannot serve is expected. */
function reportDeviceFault(error: unknown): void {
  if (!onlineManager.isOnline()) return;
  Telemetry.error(error);
}

function reportFallback(error: unknown, signal?: AbortSignal): void {
  // A cancelled read is the caller's doing, not a failure of the device path.
  if (signal?.aborted) throw error;
  reportDeviceFault(error);
}

/**
 * Once a server page is on the device: shows the person's writes still
 * waiting in the device queue, which the server's page cannot carry (after a
 * reload, the server usually answers first), and, when the device already
 * held the channel at an older sequence, replays what changed since so the
 * other stretches it holds are current too.
 */
async function settleServerPage(
  host: CacheHost,
  request: ChannelPageRequest,
  loaded: Extract<LoadedChannelPage, { source: 'server' }>,
  anchored: boolean
): Promise<void> {
  const storedSeq = await loaded.stored;
  if (storedSeq === null) return;
  if (
    (await pageHasPendingWrites(host, request)) ||
    (await pageHasQueuedReplies(host, request.channelId, loaded.page)) ||
    (!anchored &&
      (await pageLacksQueuedSends(host, request.channelId, loaded.page)))
  ) {
    refreshChannelViews(request.channelId);
  }
  if (anchored) return;
  if (BigInt(loaded.serverSeq) > BigInt(storedSeq)) {
    await catchUpAndRefresh(host, request.channelId);
  }
}

/**
 * One channel timeline page through the device cache. Undefined when channels
 * read over REST for this person, or when the device path failed and REST
 * should answer this read instead.
 */
export async function loadLocalChannelTimelinePage(
  read: ChannelTimelinePageRead
): Promise<MessageTimelinePage | undefined> {
  const host = channelCacheHost();
  if (!host) return undefined;
  watchWaitingWrites();
  const request = pageRequest(read);
  if (!request) return undefined;
  const anchored = request.before !== undefined || request.after !== undefined;
  let caughtUp = false;
  try {
    // A host still starting would hold the open up; it catches up after.
    if (read.revalidate && !anchored && channelCacheAnswered(host)) {
      try {
        await catchUpChannel(host, read.channelId);
        caughtUp = true;
      } catch (error) {
        // Offline or a failed request: what the device holds still opens.
        reportFallback(error, read.signal);
      }
    }
    let loaded = await loadChannelPage(host, request, {
      signal: read.signal,
    });
    if (loaded === 'unsupported' || loaded === 'not-ready') return undefined;
    // The views may already show a push this device page is older than.
    for (let reread = 0; reread < MAX_PUSH_REREADS; reread += 1) {
      if (loaded.source !== 'device') break;
      if (!(await pushesStored(read.channelId, loaded.storedSeq))) break;
      read.signal?.throwIfAborted();
      const again = await loadChannelPage(host, request, {
        signal: read.signal,
      });
      if (again === 'unsupported' || again === 'not-ready') return undefined;
      loaded = again;
    }
    if (!anchored && loaded.source === 'device') {
      // Opening from the device counts as use, which eviction goes by; a
      // server page records it with its coverage.
      fireAndForget(
        host.channelTimelineCommit(
          {
            channelId: read.channelId,
            touchedAtMs: Date.now(),
          },
          cacheSessionGeneration.capture()
        ),
        SYNC_SURFACE
      );
    }
    if (loaded.source === 'server') {
      fireAndForget(
        settleServerPage(host, request, loaded, anchored),
        SYNC_SURFACE
      );
    } else if (!anchored && (!read.revalidate || !caughtUp)) {
      fireAndForget(catchUpAndRefresh(host, read.channelId), SYNC_SURFACE);
    }
    // The device has just answered, so its queue is listed without a wait; a
    // server page is read again once the device holds it (`settleServerPage`).
    return loaded.source === 'device' && !anchored
      ? await withQueuedSends(host, read.channelId, loaded.page)
      : loaded.page;
  } catch (error) {
    reportFallback(error, read.signal);
    return undefined;
  }
}

/** Threads being given to the device, so one read twice is fetched once. */
const threadsBeingHeld = new Set<string>();

/** Has the device hold a thread the views were answered over REST. */
async function holdChannelThread(
  host: CacheHost,
  channelId: string,
  rootId: string
): Promise<void> {
  const key = `${channelId}:${rootId}`;
  if (threadsBeingHeld.has(key)) return;
  threadsBeingHeld.add(key);
  // The host may take seconds to start; a reload meanwhile leaves the thread
  // to the next page.
  noteUnheldRead({ channelId, rootId });
  try {
    await loadChannelThread(host, channelId, rootId);
  } catch (error) {
    reportDeviceFault(error);
  } finally {
    threadsBeingHeld.delete(key);
  }
}

async function holdUnheldRead(
  host: CacheHost,
  { channelId, rootId }: UnheldRead
): Promise<void> {
  if (rootId !== undefined) {
    await loadChannelThread(host, channelId, rootId);
    return;
  }
  const loaded = await loadChannelPage(host, {
    channelId,
    limit: PREWARM_PAGE_SIZE,
  });
  if (loaded !== 'unsupported' && loaded !== 'not-ready') {
    if (loaded.source === 'server') await loaded.stored;
  }
}

/**
 * Has the device hold the channel pages and threads a page that is gone
 * showed from the server and did not see the device store.
 */
let holdingUnheldReads: Promise<void> | undefined;

/** One pass at a time: a second caller waits on the pass already running. */
export function holdUnheldReads(host: CacheHost): Promise<void> {
  holdingUnheldReads ??= (async () => {
    try {
      await holdUnheldReadsLeft(host);
    } finally {
      holdingUnheldReads = undefined;
    }
  })();
  return holdingUnheldReads;
}

async function holdUnheldReadsLeft(host: CacheHost): Promise<void> {
  for (const read of unheldReadsLeft()) {
    // Offline it stays noted for the pass after the reconnect.
    if (!onlineManager.isOnline()) return;
    try {
      await holdUnheldRead(host, read);
      forgetUnheldRead(read, true);
    } catch {
      if (!onlineManager.isOnline()) return;
      // A channel this person cannot read (the note may be another
      // account's) or a failed request. Neither is tried again or reported:
      // the prewarm keeps what is still wanted.
      forgetUnheldRead(read, true);
    }
  }
}

/** A channel thread through the device cache; undefined to read over REST. */
export async function loadLocalChannelThread(
  channelId: string,
  rootId: string
): Promise<MessageThread | undefined> {
  const host = channelCacheHost();
  if (!host) return undefined;
  if (!channelCacheAnswered(host)) {
    // A host still starting would hold the open up; REST answers meanwhile.
    // The views keep that answer, so the device is given the thread as well,
    // or it would not hold a thread the person read.
    fireAndForget(holdChannelThread(host, channelId, rootId), SYNC_SURFACE);
    return undefined;
  }
  try {
    // Listed beside the read, not after it.
    const queued = listQueuedReplies(host, channelId);
    let loaded = await loadChannelThread(host, channelId, rootId);
    // The views may already show a push this device thread is older than.
    for (let reread = 0; reread < MAX_PUSH_REREADS; reread += 1) {
      if (loaded?.source !== 'device') break;
      if (!(await pushesStored(channelId))) break;
      loaded = await loadChannelThread(host, channelId, rootId);
    }
    if (loaded?.source === 'device') {
      fireAndForget(catchUpAndRefresh(host, channelId), SYNC_SURFACE);
    }
    if (!loaded) return undefined;
    const { thread } = loaded;
    // The server's thread cannot carry a reply still waiting to be sent.
    const overlaid = await ResultAsync.fromPromise(
      withUnsettledThreadReplies(host, channelId, thread, queued),
      (error) => error
    );
    // The thread that was read still answers.
    if (overlaid.isErr()) reportDeviceFault(overlaid.error);
    return overlaid.unwrapOr(thread);
  } catch (error) {
    reportDeviceFault(error);
    return undefined;
  }
}

/**
 * Where a message sits in its channel; undefined to resolve it over REST,
 * which also reports a message that does not exist.
 */
export async function resolveLocalChannelMessage(
  channelId: string,
  messageId: string
): Promise<
  | {
      id: string;
      kind: 'thread_reply' | 'top_level';
      thread_id: string;
      created_at: string;
    }
  | undefined
> {
  const host = channelCacheHost();
  // A host still starting would hold the open up; REST answers meanwhile.
  if (!host || !channelCacheAnswered(host)) return undefined;
  try {
    const message = await loadChannelMessage(host, channelId, messageId);
    if (!message) return undefined;
    return {
      id: message.id,
      kind: message.threadId ? 'thread_reply' : 'top_level',
      thread_id: message.threadId ?? message.id,
      created_at: message.createdAt,
    };
  } catch (error) {
    reportDeviceFault(error);
    return undefined;
  }
}
