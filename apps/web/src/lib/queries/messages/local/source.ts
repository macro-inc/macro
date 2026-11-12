import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import type {
  MessageCursor,
  MessageThread,
  MessageTimelinePage,
} from '@service-storage/messages';
import {
  catchUpAndRefresh,
  catchUpChannel,
  refreshChannelViews,
} from './catch-up';
import { channelCacheAnswered, channelCacheHost } from './flag';
import {
  type ChannelPageRequest,
  type LoadedChannelPage,
  loadChannelPage,
  pageHasPendingWrites,
} from './pages';
import { sortKeyFromCursor } from './sort-key';
import { loadChannelMessage, loadChannelThread } from './thread';

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

function reportFallback(error: unknown, signal?: AbortSignal): void {
  // A cancelled read is the caller's doing, not a failure of the device path.
  if (signal?.aborted) throw error;
  Telemetry.error(error);
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
  if (await pageHasPendingWrites(host, request)) {
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
    const loaded = await loadChannelPage(host, request, {
      signal: read.signal,
    });
    if (loaded === 'unsupported' || loaded === 'not-ready') return undefined;
    if (!anchored && loaded.source === 'device') {
      // Opening from the device counts as use, which eviction goes by; a
      // server page records it with its coverage.
      fireAndForget(
        host.channelTimelineCommit({
          channelId: read.channelId,
          touchedAtMs: Date.now(),
        }),
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
    return loaded.page;
  } catch (error) {
    reportFallback(error, read.signal);
    return undefined;
  }
}

/** A channel thread through the device cache; undefined to read over REST. */
export async function loadLocalChannelThread(
  channelId: string,
  rootId: string
): Promise<MessageThread | undefined> {
  const host = channelCacheHost();
  // A host still starting would hold the open up; REST answers meanwhile.
  if (!host || !channelCacheAnswered(host)) return undefined;
  try {
    const loaded = await loadChannelThread(host, channelId, rootId);
    if (loaded?.source === 'device') {
      fireAndForget(catchUpAndRefresh(host, channelId), SYNC_SURFACE);
    }
    return loaded?.thread;
  } catch (error) {
    Telemetry.error(error);
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
    Telemetry.error(error);
    return undefined;
  }
}
