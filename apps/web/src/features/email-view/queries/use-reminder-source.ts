import { buildFlatSoupRows, createSoupLoadMoreRow } from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { EntityData } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';
import {
  buildReminderQuery,
  reminderMatchesSearch,
  reminderMatchesStatus,
  reminderStatusFromFacets,
} from './reminder-query';
import type {
  EmailDataSource,
  EmailDataSourceInput,
  EmailDataSourceItem,
} from './use-email-query';

/**
 * The Reminders tab's list: the user's reminders in the selected status, from
 * Soup. Inbox scope does not apply — reminders belong to the user, not to a
 * mailbox. Search narrows the loaded page by description: the search service
 * has no reminders index, so a service query could never return one.
 */
export function useReminderSource(
  state: EmailDataSourceInput
): EmailDataSource {
  const notificationSource = useGlobalNotificationSource();
  const enabled = () => state.tab === 'reminders';
  const status = createMemo(() => reminderStatusFromFacets(state.facets));
  const queryArgs = createMemo(() => buildReminderQuery(status()));

  const query = useSoupAstItemsQuery(queryArgs, () => ({
    enabled: enabled(),
    // Websocket-driven cache inserts prepend into every matching query; only
    // reminders belong here. Status is re-checked on the rows below.
    meta: { insertFilter: (item) => item.tag === 'reminder' },
  }));

  const isListPending = () => query.isLoading || query.isPlaceholderData;

  const rawEntities = (): EntityData[] => {
    // Previous-status rows are not valid results for the new query.
    if (isListPending()) return [];
    return query.data?.entities ?? [];
  };

  // A row the cache hands back may have moved status since the page was
  // fetched (marked done, come due); the page is the server's answer, the
  // status check keeps optimistic updates honest until the refetch lands.
  const entities = createMemo(() =>
    rawEntities()
      .filter(
        (entity) =>
          reminderMatchesStatus(entity, status()) &&
          reminderMatchesSearch(entity, state.search)
      )
      .map((entity) => withEntityNotifications(entity, notificationSource))
  );

  const hasMore = () => !isListPending() && query.hasNextPage;
  const isLoadingMore = () => query.isFetchingNextPage;

  // Flat, like the standalone view was: Soup already orders reminders by
  // when they fire, and date headers would only restate that.
  const items = createMemo((): EmailDataSourceItem[] => {
    const rows: EmailDataSourceItem[] = buildFlatSoupRows(entities());
    if (hasMore()) {
      rows.push(
        createSoupLoadMoreRow({
          scopeId: `email:reminders:${status()}`,
          isLoading: isLoadingMore(),
        })
      );
    }
    return rows;
  });

  return {
    items,
    isLoading: isListPending,
    isFetching: () => query.isFetching,
    error: () => query.error ?? undefined,
    hasMore,
    isLoadingMore,
    loadMore: async () => {
      await query.fetchNextPage();
    },
    refresh: async () => {
      await query.refresh();
    },
  };
}
