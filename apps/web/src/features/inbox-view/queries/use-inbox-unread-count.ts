import { testFacets } from '@app/features/soup';
import { hasNotificationCoverage } from '@app/features/soup/notification-coverage';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import { boundedCount } from '@queries/soup/bounded-count';
import { createBoundedCountPagination } from '@queries/soup/bounded-count-pagination';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';
import { INBOX_FACETS } from '../inbox-facets';
import {
  selectInboxEntities,
  useInboxQueryCapabilities,
} from './inbox-eligibility';
import { soupItemMatchesInboxTab } from './inbox-item-filter';
import { buildInboxQuery, type InboxViewContext } from './inbox-query';

export function useInboxUnreadCount() {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();
  const capabilities = useInboxQueryCapabilities();
  const context = createMemo(
    (): InboxViewContext => ({
      tab: 'signal',
      facets: { read: ['unread'] },
      facetContext: { notificationSource },
      capabilities: capabilities(),
      userId: userId(),
    })
  );
  const args = createMemo(() => buildInboxQuery(context()));
  const query = useSoupAstItemsQuery(args, () => ({
    showSupportedForeignEntities: capabilities().foreignEntities,
    meta: { insertFilter: (item) => soupItemMatchesInboxTab(item, 'signal') },
  }));

  const count = () => {
    if (query.isLoading || query.error || query.isPlaceholderData) return;
    const entities = query.data?.entities;
    if (!entities) return;
    const current = context();
    const unread = selectInboxEntities(
      entities,
      current,
      notificationSource
    ).filter((entity) =>
      testFacets(current.facets, INBOX_FACETS, entity, current.facetContext)
    );
    // Keep a channel and its thread rows distinct. Do not apply the list's
    // admission retention: reading a retained row must decrement the badge.
    return boundedCount(
      unread.map((entity) => `${entity.type}:${entity.id}`),
      !query.hasNextPage &&
        hasNotificationCoverage(entities, notificationSource)
    );
  };
  createBoundedCountPagination(query, count);
  return count;
}
