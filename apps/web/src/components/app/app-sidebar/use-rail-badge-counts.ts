import type { ListView } from '@app/constants/list-views';
import {
  compileToAst,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { getInboxSignalFilters } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  filterNotDoneNotifications,
  filterValidNotifications,
  isEmailEntity,
} from '@entity';
import { stackNotifications, type UnifiedNotification } from '@notifications';
import { notificationIsRead } from '@notifications/notification-helpers';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createEffect, createMemo } from 'solid-js';

const SIGNAL_QUERY_LIMIT = 100;
const SIGNAL_QUERY_STALE_MS = 5 * 60 * 1000;

/** The nav views that carry an unread badge; every other view never does. */
export type BadgedNavView = Extract<ListView, 'inbox' | 'mail' | 'channels'>;

/**
 * Which rail icon an unread entity's badge count rolls up into. Only
 * Channels rolls up from the raw notification cache; Inbox and Email are
 * computed from the Signal soup query below, and the remaining rail icons
 * deliberately carry no badge.
 */
const BADGE_VIEW_BY_ENTITY_TYPE: Partial<Record<string, BadgedNavView>> = {
  channel: 'channels',
};

/**
 * Unread counts for the badged rail icons (inbox, mail, channels), keyed by
 * rail link id.
 *
 * Inbox and Email mirror the inbox Signal tab: the same soup query decides
 * membership (email importance, recency windows, per-type done state) and the
 * notification cache decides which of those entities are unread. Channels
 * counts unread channel entities straight from the cache.
 *
 * The membership query is gated on the live cache holding at least one
 * unread notification — with none, no badge can light, so mounting the hook
 * costs nothing. Membership intentionally uses its own small flat query
 * rather than reusing the Inbox tab's render query: that query's key varies
 * with feature flags and grouping (grouped GraphQL vs flat REST), so sharing
 * would couple the badge to inbox rendering internals and silently break on
 * either side. Freshness comes from the live notification stream instead —
 * see the refetch effect below.
 */
export function useRailBadgeCounts() {
  const notificationSource = useGlobalNotificationSource();

  // Entity ids carrying at least one live unread notification. Drives the
  // query gate, the freshness refetch, and the counts' early exit.
  const unreadEntityIds = createMemo(() => {
    const ids = new Set<string>();
    for (const notification of filterNotDoneNotifications(
      filterValidNotifications(notificationSource.notifications())
    )) {
      if (!notificationIsRead(notification)) ids.add(notification.entity_id);
    }
    return ids;
  });

  const signalQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: SIGNAL_QUERY_LIMIT, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom(getInboxSignalFilters())),
    }),
    () => ({
      staleTime: SIGNAL_QUERY_STALE_MS,
      // Nothing unread → no badge can light → skip the query entirely.
      enabled: unreadEntityIds().size > 0,
    })
  );

  // Membership freshness: notifications arrive live over the websocket, but
  // the Signal membership snapshot is cached (staleTime above). Refresh the
  // snapshot whenever an entity turns unread for the first time, so a
  // just-arrived item can light its dot right away instead of waiting out
  // the staleTime. `seen` only grows, so each entity triggers at most one
  // refetch and the effect can never loop.
  const seenUnreadIds = new Set<string>();
  createEffect(() => {
    let hasNew = false;
    for (const id of unreadEntityIds()) {
      if (!seenUnreadIds.has(id)) {
        seenUnreadIds.add(id);
        hasNew = true;
      }
    }
    // Skip during the initial fetch — its response is already up to date.
    if (hasNew && signalQuery.data && !signalQuery.isFetching) {
      void signalQuery.refetch();
    }
  });

  const notificationsByEntityId = createMemo(() => {
    const map = new Map<string, UnifiedNotification[]>();
    for (const notification of notificationSource.notifications()) {
      const list = map.get(notification.entity_id);
      if (list) list.push(notification);
      else map.set(notification.entity_id, [notification]);
    }
    return map;
  });

  return createMemo<Partial<Record<BadgedNavView, number>>>(() => {
    const counts: Partial<Record<BadgedNavView, number>> = {};
    if (unreadEntityIds().size === 0) return counts;

    // Inbox rows render one row per notification STACK (a channel can carry
    // both a top-level-messages stack and a thread-replies stack), so the
    // badge counts unread stacks via the same stacking pipeline the rows use.
    for (const entity of signalQuery.data?.entities ?? []) {
      const notifications = notificationsByEntityId().get(entity.id);
      if (!notifications?.length) continue;
      const stacks = stackNotifications(
        filterNotDoneNotifications(filterValidNotifications(notifications))
      );
      const unreadStacks = stacks.filter((stack) =>
        stack.notifications.some(
          (notification) => !notificationIsRead(notification)
        )
      ).length;
      if (unreadStacks === 0) continue;
      counts.inbox = (counts.inbox ?? 0) + unreadStacks;
      if (isEmailEntity(entity))
        counts.mail = (counts.mail ?? 0) + unreadStacks;
    }

    for (const [entityKey, notifications] of Object.entries(
      notificationSource.notificationsByEntity()
    )) {
      if (!notifications?.some((n) => !notificationIsRead(n))) continue;
      const view = BADGE_VIEW_BY_ENTITY_TYPE[entityKey.split('@')[0]];
      if (view) counts[view] = (counts[view] ?? 0) + 1;
    }

    return counts;
  });
}
