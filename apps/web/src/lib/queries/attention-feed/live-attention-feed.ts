import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Client } from '@urql/core';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import {
  type AttentionFeedCachedQuery,
  writeAttentionFeedPatches,
} from './attention-feed-cache';
import type { AttentionFeedShape } from './attention-feed-types';
import {
  type AttentionFeedUpdates,
  subscribeToAttentionFeedUpdates,
} from './attention-feed-updates';

/** First delay before following a feed again after its live stream ended. */
export const ATTENTION_FEED_RESUBSCRIBE_DELAY_MS = 3_000;
/** Longest delay between attempts while the live stream keeps failing. */
export const ATTENTION_FEED_MAX_RESUBSCRIBE_DELAY_MS = 60_000;

/** The paged feed query a live feed writes changes into. */
export type LiveAttentionFeedQuery = {
  /** The cursor each loaded page was read from. */
  readonly data: { readonly cursors: readonly (string | null)[] } | undefined;
  readonly isFetching: boolean;
  readonly hasNextPage: boolean;
  refetch(options: { requestPolicy: 'network-only' }): Promise<unknown>;
};

export type LiveAttentionFeedOptions<
  Page,
  Entry,
  Patch,
  Variables extends Record<string, unknown>,
  UpdateData,
  UpdateVariables extends Record<string, unknown>,
> = {
  client: Accessor<Client>;
  /** The normalized cache holding the feed's pages, when it is available. */
  cacheHost: Accessor<Pick<CacheHost, 'readQuery' | 'writeQuery'> | undefined>;
  enabled: Accessor<boolean>;
  shape: AttentionFeedShape<Page, Entry, Patch>;
  query: LiveAttentionFeedQuery;
  /** The cached page query and the variables of the page read at `cursor`. */
  pages: {
    cachedQuery: AttentionFeedCachedQuery;
    variables: (cursor: string | null) => Variables;
  };
  /** The live stream for the same feed; restarted when its variables change. */
  updates: AttentionFeedUpdates<UpdateData, Patch, UpdateVariables> & {
    variables: Accessor<UpdateVariables>;
  };
  /** Subscribes to transport reconnects, after which changes may be missed. */
  onReconnected?: (listener: () => void) => () => void;
  /** Sees each batch before it is placed, in arrival order. */
  onPatches?: (patches: readonly Patch[]) => void;
  /** Runs after each fresh read of the feed lands. */
  onRefetched?: () => void;
  /** Telemetry surface for detached work. */
  surface: string;
};

/**
 * Keeps a paged attention feed live. The server sends each change already
 * placed in the feed, and the change is written into the cached pages, so the
 * paged query shows it without a network read. The feed reads again only
 * when changes may have been missed.
 */
export function createLiveAttentionFeed<
  Page,
  Entry,
  Patch,
  Variables extends Record<string, unknown>,
  UpdateData,
  UpdateVariables extends Record<string, unknown>,
>(
  options: LiveAttentionFeedOptions<
    Page,
    Entry,
    Patch,
    Variables,
    UpdateData,
    UpdateVariables
  >
) {
  const { query, surface } = options;

  // A read requested while one runs is followed by one more.
  let refetching = false;
  let refetchAgain = false;
  const refetch = async () => {
    if (refetching) {
      refetchAgain = true;
      return;
    }
    refetching = true;
    try {
      do {
        refetchAgain = false;
        await query.refetch({ requestPolicy: 'network-only' });
        options.onRefetched?.();
      } while (refetchAgain);
    } catch (error) {
      console.warn('Attention feed refresh failed', error);
    } finally {
      refetching = false;
    }
  };

  // Batches are written in arrival order, and only between page reads, so a
  // read that started before a batch cannot land over it.
  let pending: Patch[] = [];
  let writing = false;
  const writePending = async () => {
    if (writing || pending.length === 0 || query.isFetching) return;
    const host = options.cacheHost();
    const batch = pending;
    pending = [];
    // Without the cache there are no pages to place changes in.
    if (!host) {
      fireAndForget(refetch(), surface);
      return;
    }
    writing = true;
    try {
      const pages = query.data?.cursors ?? [];
      const placed = await writeAttentionFeedPatches(
        options.shape,
        host,
        options.pages.cachedQuery,
        pages.map((cursor) => options.pages.variables(cursor)),
        batch,
        query.hasNextPage
      );
      if (!placed) fireAndForget(refetch(), surface);
    } catch (error) {
      console.warn('Attention feed update failed', error);
      fireAndForget(refetch(), surface);
    } finally {
      writing = false;
      fireAndForget(writePending(), surface);
    }
  };
  createEffect(
    on(
      () => query.isFetching,
      (fetching) => {
        if (!fetching) fireAndForget(writePending(), surface);
      }
    )
  );

  const applyPatches = (patches: readonly Patch[]) => {
    options.onPatches?.(patches);
    pending.push(...patches);
    fireAndForget(writePending(), surface);
  };

  // The live stream is an external system: follow it while the feed is
  // enabled, and again with each new client or set of variables.
  createEffect(() => {
    if (!options.enabled()) return;
    const client = options.client();
    const variables = options.updates.variables();
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = ATTENTION_FEED_RESUBSCRIBE_DELAY_MS;
    let unsubscribe = () => {};
    const follow = () => {
      unsubscribe = subscribeToAttentionFeedUpdates(
        client,
        options.updates,
        variables,
        {
          patches: (patches) => {
            delay = ATTENTION_FEED_RESUBSCRIBE_DELAY_MS;
            applyPatches(patches);
          },
          interrupted: () => {
            if (disposed) return;
            retry = setTimeout(() => {
              if (disposed) return;
              follow();
              // Changes made while the stream was down are only in a read.
              fireAndForget(refetch(), surface);
            }, delay);
            delay = Math.min(
              delay * 2,
              ATTENTION_FEED_MAX_RESUBSCRIBE_DELAY_MS
            );
          },
        }
      );
    };
    follow();
    const stopReconnects = options.onReconnected?.(() =>
      fireAndForget(refetch(), surface)
    );
    onCleanup(() => {
      disposed = true;
      pending = [];
      if (retry !== undefined) clearTimeout(retry);
      unsubscribe();
      stopReconnects?.();
    });
  });

  return { refetch, applyPatches };
}
