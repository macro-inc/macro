import {
  compileToAst,
  type Query,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import {
  type SoupApiItemFilter,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createMemo } from 'solid-js';
import { entitySortTs } from './entity-events';
import type { TimelineFeed, TimelineItem } from './timeline-types';

const PAGE_SIZE = 50;

/**
 * Notification event types the timeline skips: plumbing rather than team
 * activity, plus email arrivals — notifications carry no signal/noise flag
 * client-side, so Firehose sources email activity from signal-filtered soup
 * feeds instead (`Importance(true)` compiles to the thread's `is_signal`).
 */
const EXCLUDED_NOTIFICATION_TAGS: ReadonlySet<string> = new Set([
  'inbox_reauth_required',
  'new_email',
]);

/**
 * A timeline feed over the user's notification stream. The server returns
 * only one done-state per query (omitted = active), so full-history surfaces
 * create one feed per done state and merge them.
 */
export function createNotificationTimelineFeed(args: {
  done?: boolean;
}): TimelineFeed {
  const query = useUserNotificationsQuery({
    limit: PAGE_SIZE,
    done: args.done,
  });

  const rows = createMemo((): UnifiedNotification[] => query.data ?? []);

  const items = createMemo((): TimelineItem[] => {
    const mapped: TimelineItem[] = [];
    for (const notification of rows()) {
      if (
        EXCLUDED_NOTIFICATION_TAGS.has(notification.notification_metadata.tag)
      ) {
        continue;
      }
      const ts = new Date(notification.created_at).getTime();
      if (Number.isNaN(ts)) continue;
      mapped.push({
        kind: 'notification',
        id: notification.id,
        ts,
        notification,
      });
    }
    return mapped;
  });

  // Cursor position: rows arrive newest-first, so the boundary is the oldest
  // fetched row — including excluded ones, which still advance the cursor.
  const boundaryTs = createMemo((): number | undefined => {
    let boundary: number | undefined;
    for (const notification of rows()) {
      const ts = new Date(notification.created_at).getTime();
      if (Number.isNaN(ts)) continue;
      if (boundary === undefined || ts < boundary) boundary = ts;
    }
    return boundary;
  });

  return {
    items,
    boundaryTs,
    hasMore: () => query.hasNextPage ?? false,
    isLoading: () => query.isLoading,
    isFetchingMore: () => query.isFetchingNextPage,
    fetchMore: () => {
      if (!query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}

/**
 * A timeline feed over a soup query, sorted by `updated_at`, with each row
 * mapped to zero or more activity events. Events may sit at timestamps older
 * than their row (e.g. a document's "created" event); the boundary tracks
 * the row sort key so the merge withholds them until pagination catches up.
 */
export function createSoupTimelineFeed(args: {
  query: () => Query;
  map: (entity: EntityData) => TimelineItem[];
  enabled?: () => boolean;
  /**
   * Mirror of the server query for the websocket cache layer: optimistic
   * inserts bypass the server AST, so without this gate any entity the user
   * touches (e.g. an auto-ingested attachment doc bumped by viewing it) gets
   * prepended into this feed's cache.
   */
  itemFilter?: SoupApiItemFilter;
}): TimelineFeed {
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: PAGE_SIZE, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom(args.query())),
    }),
    () => ({
      enabled: args.enabled?.() ?? true,
      meta: args.itemFilter ? { itemFilter: args.itemFilter } : undefined,
    })
  );

  const entities = createMemo((): EntityData[] => query.data?.entities ?? []);

  const items = createMemo((): TimelineItem[] =>
    entities().flatMap((entity) => args.map(entity))
  );

  const boundaryTs = createMemo((): number | undefined => {
    let boundary: number | undefined;
    for (const entity of entities()) {
      const ts = entitySortTs(entity);
      if (ts === undefined) continue;
      if (boundary === undefined || ts < boundary) boundary = ts;
    }
    return boundary;
  });

  return {
    items,
    boundaryTs,
    hasMore: () => query.hasNextPage ?? false,
    // While disabled (e.g. the user id has not resolved yet) the feed reports
    // loading so the merge withholds output instead of treating it as empty.
    isLoading: () => query.isLoading || !(args.enabled?.() ?? true),
    isFetchingMore: () => query.isFetchingNextPage,
    fetchMore: () => {
      if (!query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}
