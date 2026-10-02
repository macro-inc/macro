import {
  buildFlatSoupRows,
  createSoupLoadMoreRow,
  createSoupRowStore,
  createTagFacetContext,
  tagFacetReady,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { enableReminders } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isEmailEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { useEmailReminderCollection } from '@queries/reminders/email-collection';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { ListEmailRemindersParams } from '@service-storage/generated/schemas/listEmailRemindersParams';
import { createMemo, indexArray } from 'solid-js';
import { buildEmailQuery } from './email-query';
import type {
  EmailDataSource,
  EmailDataSourceInput,
  EmailDataSourceItem,
  UseEmailDataSourceOptions,
} from './use-email-query';

/** Original email rows in reminder order, with membership and facets owned by the server. */
export function useReminderEmailSource(
  state: EmailDataSourceInput,
  options: UseEmailDataSourceOptions
): EmailDataSource {
  const userId = useUserId();
  const enabled = useFeatureFlag(enableReminders);
  const notificationSource = useGlobalNotificationSource();
  const tagContext = createMemo(() => createTagFacetContext(options.tagSets()));
  const ready = () => tagFacetReady(state.facets, options.tagSetsReady());
  const active = () =>
    state.tab === 'reminders' && enabled().enabled && ready();
  const filters = createMemo(
    (): ListEmailRemindersParams => ({
      inboxIds: state.inboxIds,
      noInboxes: state.inboxIds?.length === 0,
      done:
        state.facets.done?.length === 1
          ? state.facets.done[0] === 'done'
          : undefined,
      read:
        state.facets.read?.length === 1
          ? state.facets.read[0] === 'read'
          : undefined,
      calendar: state.facets.calendar?.includes('has-calendar-invite'),
      tags: (state.facets.tags ?? [])
        .flatMap((id) => {
          const property = tagContext().tagPropertyDefinitionByOptionId.get(id);
          return property ? [`${property}:${id}`] : [];
        })
        .sort(),
      attachments: (state.facets.attachments ?? [])
        .map((id) => id.replace('attachment-', ''))
        .sort(),
    })
  );
  const collection = useEmailReminderCollection(() => ({
    userId: userId(),
    enabled: active(),
    filters: filters(),
  }));
  const pages = createMemo(() =>
    queryReadyGate(collection) ? collection.data.pages : []
  );
  const hydration = indexArray(pages, (page) => {
    const ids = () => page().items.map((item) => item.threadId);
    return useSoupAstItemsQuery(
      () =>
        buildEmailQuery(
          {
            tab: 'reminders',
            inboxIds: state.inboxIds,
            facets: {},
            facetContext: tagContext(),
          },
          ids()
        ),
      () => ({ enabled: active() && ids().length > 0, keepPreviousData: false })
    );
  });
  const entities = createMemo(() => {
    const byId = new Map(
      hydration().flatMap((query) =>
        queryReadyGate(query) && !query.isPlaceholderData
          ? query.data.entities
              .filter(isEmailEntity)
              .map((entity) => [entity.id, entity] as const)
          : []
      )
    );
    const seen = new Set<string>();
    return pages().flatMap((page) =>
      page.items.flatMap((item) => {
        const email = byId.get(item.threadId);
        if (!email || seen.has(email.id)) return [];
        seen.add(email.id);
        return [withEntityNotifications(email, notificationSource)];
      })
    );
  });
  const built = createMemo((): EmailDataSourceItem[] => {
    const rows: EmailDataSourceItem[] = buildFlatSoupRows(entities());
    // A sparse server page is not an empty collection. Keep the continuation
    // visible and reachable by both the virtualizer and keyboard navigation.
    if (collection.hasNextPage)
      rows.push(
        createSoupLoadMoreRow({
          scopeId: 'email:reminders',
          isLoading: collection.isFetchingNextPage,
        })
      );
    return rows;
  });
  const items = createSoupRowStore(built);
  const hydrationPending = () =>
    hydration().some(
      (query, index) => pages()[index].items.length > 0 && query.isPending
    );
  return {
    items,
    isLoading: () =>
      !ready() ||
      collection.isLoading ||
      (entities().length === 0 && hydrationPending()),
    isFetching: () =>
      collection.isFetching || hydration().some((query) => query.isFetching),
    // Keep usable cached email rows through background failures.
    error: () =>
      entities().length > 0
        ? undefined
        : (collection.error ??
          hydration().find((query) => query.error)?.error ??
          undefined),
    hasMore: () => collection.hasNextPage,
    isLoadingMore: () => collection.isFetchingNextPage,
    loadMore: async () => {
      if (collection.hasNextPage && !collection.isFetchingNextPage)
        await collection.fetchNextPage();
    },
    refresh: async () => {
      await Promise.all([
        collection.refetch(),
        ...hydration().map((query) => query.refresh()),
      ]);
    },
  };
}
