import {
  compileToAst,
  type Query,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';
import type { TimelineFeed, TimelineItem } from './timeline-types';

const PAGE_SIZE = 50;

/** Notification event types that are plumbing rather than team activity. */
const EXCLUDED_NOTIFICATION_TAGS: ReadonlySet<string> = new Set([
  'inbox_reauth_required',
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

  const items = createMemo((): TimelineItem[] => {
    const notifications: UnifiedNotification[] = query.data ?? [];
    const mapped: TimelineItem[] = [];
    for (const notification of notifications) {
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

  return {
    items,
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
 * mapped to an activity event. Rows the mapper returns `undefined` for are
 * dropped.
 */
export function createSoupTimelineFeed(args: {
  query: () => Query;
  map: (entity: EntityData) => TimelineItem | undefined;
  enabled?: () => boolean;
}): TimelineFeed {
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: PAGE_SIZE, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom(args.query())),
    }),
    () => ({ enabled: args.enabled?.() ?? true })
  );

  const items = createMemo((): TimelineItem[] => {
    const entities = query.data?.entities ?? [];
    const mapped: TimelineItem[] = [];
    for (const entity of entities) {
      const item = args.map(entity);
      if (item) mapped.push(item);
    }
    return mapped;
  });

  return {
    items,
    // While disabled (e.g. the user id has not resolved yet) the feed reports
    // loading so the merge withholds output instead of treating it as empty.
    hasMore: () => query.hasNextPage ?? false,
    isLoading: () => query.isLoading || !(args.enabled?.() ?? true),
    isFetchingMore: () => query.isFetchingNextPage,
    fetchMore: () => {
      if (!query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}
