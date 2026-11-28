import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { fireAndForget } from '@core/util/fireAndForget';
import { isChannelEntity } from '@entity';
import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createRequest } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import {
  type SoupAstItemsQuery,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '../soup/items';
import { channelNotificationRefresh } from './notification-refresh';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

const BATCH_SIZE = 500;

/** When live updates read a list's later pages again. */
export type LaterPageReads = {
  /** Live updates read the later pages again only while this holds. */
  read: Accessor<boolean>;
  /** How long a later page may miss live updates before it is read again. */
  freshMs: number;
};

/** A later page that has missed live updates since `since`. */
type MissedPage = { query: QueryRevalidation; since: number };

export function channelsByIdsQueryArgs(
  channelIds: readonly string[]
): SoupAstItemsQueryArgs {
  return {
    params: {
      limit: Math.min(BATCH_SIZE, Math.max(1, channelIds.length)),
      sort_method: 'created_at',
    },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({ include: { channelId: [...channelIds] } })
      )
    ),
  };
}

/**
 * Keep each channel list's bounded unread and mention projections current,
 * including cached rows. A list given `channelTypes` also waits for a new
 * channel of those types to reach its first page. With `laterPages`, live
 * updates read only the first page while its `read` is false, and each later
 * page is read once more after it has missed them for `freshMs`, while
 * `read` holds.
 */
export function registerChannelListNotificationRefresh(
  query: SoupAstItemsQuery,
  channelTypes?: readonly string[],
  channelIds?: Accessor<ReadonlySet<string>>,
  laterPages?: LaterPageReads
) {
  // The first page comes first (its cursor is null).
  const pages = () => query.revalidationQueries ?? [];
  if (laterPages) catchUpLaterPages(pages, laterPages);
  registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: pages().slice(0, (laterPages?.read() ?? true) ? undefined : 1),
    reader: {
      enabled: query.transport === 'graphql' && query.isEnabled,
      fetching: query.isFetching,
      channelTypes,
      channelIds: channelIds?.(),
      filtered: true,
      notificationIds: query.isPending
        ? []
        : (query.data?.entities ?? [])
            .filter(isChannelEntity)
            .flatMap((channel) =>
              [
                ...(channel.unreadNotifications ?? []),
                ...(channel.unreadMentions ?? []),
              ].map(({ id }) => id)
            ),
    },
  }));
}

/**
 * Later pages miss live updates while they are not read: from when reads
 * stop, or from when a page lands while they are stopped. Once one has missed
 * them for `freshMs`, it is read again while reads hold, in the refresh
 * queue's turn; a page the queue does not read, because reads stopped first,
 * keeps its deadline for when they resume, or for when its dropped read
 * settles if they resumed before it did. A page whose read fails while reads
 * hold waits for the next time they resume.
 */
function catchUpLaterPages(
  pages: Accessor<readonly QueryRevalidation[]>,
  { read, freshMs }: LaterPageReads
) {
  const missed = new Map<number, MissedPage>();
  const queued = new Set<number>();
  // How many times reads have stopped, so a read can tell whether they
  // stopped and resumed while it waited in the queue.
  let stops = 0;
  // Pages whose read failed while reads held, by the cycle it failed in.
  const failed = new Map<number, number>();
  // The current read cycle's deadline, while reads hold.
  let rearm: (() => void) | undefined;
  const readable = (key: number) =>
    !queued.has(key) && failed.get(key) !== stops;
  const readAgain = async (key: number, page: MissedPage) => {
    queued.add(key);
    const cycle = stops;
    const landed = await channelNotificationRefresh(
      getGraphqlSoupClient()
    ).readAgain(page.query, page.since);
    queued.delete(key);
    if (landed && missed.get(key) === page) missed.delete(key);
    // One that failed within its own cycle waits for the next, as a dropped
    // one does, even when another page's turn comes first.
    if (!landed && cycle === stops) failed.set(key, cycle);
    // A read the queue dropped because reads stopped, settling after they
    // resumed, was skipped by the new cycle's deadline as still queued.
    if (cycle !== stops) rearm?.();
  };
  createEffect(
    on([read, pages], ([reads, all]) => {
      const later = new Map(
        all
          .slice(1)
          .map((page) => [
            createRequest(page.document, page.variables).key,
            page,
          ])
      );
      for (const key of [...missed.keys()])
        if (!later.has(key)) {
          missed.delete(key);
          failed.delete(key);
        }
      if (!reads) {
        stops += 1;
        const now = Date.now();
        for (const [key, query] of later)
          if (!missed.has(key)) missed.set(key, { query, since: now });
        return;
      }
      // A deadline, not a debounce: each page waits out its own.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = () => {
        clearTimeout(timer);
        const waiting = [...missed].filter(([key]) => readable(key));
        if (waiting.length === 0) return;
        const due = Math.min(...waiting.map(([, page]) => page.since));
        timer = setTimeout(
          () => {
            for (const [key, page] of missed)
              if (readable(key) && page.since + freshMs <= Date.now())
                fireAndForget(readAgain(key, page), 'channel-list-later-pages');
            wait();
          },
          Math.max(0, due + freshMs - Date.now())
        );
      };
      rearm = wait;
      wait();
      onCleanup(() => {
        rearm = undefined;
        clearTimeout(timer);
      });
    })
  );
}

/** One Soup owner supplies local rows, missing-record fetches, and unread updates. */
export function useChannelsByIdsQuery(
  channelIds: Accessor<readonly string[]>,
  options: Accessor<{ cacheFirst?: boolean }> = () => ({})
) {
  // Soup reads its arguments from multiple reactive computations. Compile the
  // ID filter and membership set once per membership change.
  const membership = createMemo(() => {
    const ids = channelIds();
    return {
      ids,
      idSet: new Set(ids),
      args: channelsByIdsQueryArgs(ids),
    };
  });
  const query = useSoupAstItemsQuery(
    () => membership().args,
    () => {
      const ids = membership().ids;
      return {
        enabled: ids.length > 0,
        staleTime: 30_000,
        graphqlProjection: 'channel-list',
        graphqlCacheFirstEntities: options().cacheFirst
          ? ids.map((entityId) => ({ entityType: 'CHANNEL', entityId }))
          : undefined,
      };
    }
  );
  registerChannelListNotificationRefresh(
    query,
    undefined,
    () => membership().idSet
  );
  createEffect(() => {
    if (
      !query.isEnabled ||
      query.isPending ||
      query.isFetching ||
      query.fetchError ||
      query.error ||
      !query.hasNextPage
    )
      return;
    fireAndForget(query.fetchNextPage(), 'channels-by-id');
  });
  return query;
}
