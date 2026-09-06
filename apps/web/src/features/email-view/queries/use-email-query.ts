import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  createSoupLoadMoreRow,
  type SoupRow,
  testFacets,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import {
  type EmailEntity,
  type EntityData,
  isEmailEntity,
  type WithNotification,
} from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import { EMAIL_FACETS } from '../filters/email-facets';
import type { EmailTab, EmailViewState } from '../types';
import { buildEmailQuery, type EmailQueryContext } from './email-query';
import { groupEmailEntitiesByDate } from './email-results';
import { buildEmailSearchRequest } from './email-search';

export type EmailDataSourceItem = SoupRow<WithNotification<EntityData>>;

export type EmailDataSource = ListDataSource<EmailDataSourceItem>;

export type EmailDataSourceInput = Pick<
  EmailViewState,
  'tab' | 'search' | 'inboxIds' | 'facets'
>;

/**
 * The server owns importance, calendar, sent and inbox scoping, so — as with
 * the legacy presets' client filters — only the shapes a cached entity can
 * contradict are re-checked here.
 */
function emailMatchesTab(
  entity: EmailEntity,
  tab: EmailTab,
  userId: string | undefined
): boolean {
  return match(tab)
    .with('drafts', () => entity.isDraft)
    .with('shared', () => userId !== undefined && entity.ownerId !== userId)
    .with('important', 'noise', 'sent', 'calendar', 'all', () => true)
    .exhaustive();
}

type AdmittedEmails = {
  scope: string;
  admittedIds: Set<string>;
  items: EmailEntity[];
};

/** Query, service search, and row assembly owned by the Email view. */
export function useEmailDataSource(
  state: EmailDataSourceInput
): EmailDataSource {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const queryContext = createMemo(
    (): EmailQueryContext => ({
      tab: state.tab,
      inboxIds: state.inboxIds === undefined ? undefined : [...state.inboxIds],
      facets: state.facets,
    })
  );

  const queryArgs = createMemo(() => buildEmailQuery(queryContext()));
  const query = useSoupAstItemsQuery(queryArgs);

  const selectEmails = (entities: EntityData[]): EmailEntity[] => {
    const context = queryContext();
    const selected: EmailEntity[] = [];
    for (const entity of entities) {
      if (!isEmailEntity(entity)) continue;
      if (!emailMatchesTab(entity, context.tab, userId())) continue;

      selected.push(entity);
    }
    return selected;
  };

  // The quick-access pool behind local search holds no email threads, so
  // every search result comes from the search service.
  const search = createSearchState({
    text: () => state.search,
    disableLocalSearch: () => true,
    buildRequest: (request) => buildEmailSearchRequest(queryContext(), request),
  });

  const rawEntities = createMemo<EntityData[]>((previous) => {
    if (!search.isSearching()) {
      if (query.isLoading) return previous;

      return query.data?.entities ?? [];
    }

    const results = search.data();
    if (
      results.length === 0 &&
      previous.length > 0 &&
      search.isLocalSearchSettling()
    ) {
      return previous;
    }
    return results;
  }, []);

  // Keep rows admitted after they transition from unread to read: opening a
  // thread marks it read, and with the Unread filter on the row would
  // otherwise vanish from under the preview. Changing the tab, inbox scope,
  // or read filter starts a new admission scope.
  const entities = createMemo<AdmittedEmails>(
    (previous) => {
      const context = queryContext();
      const emails = selectEmails(rawEntities());
      const activeRead = context.facets.read ?? [];
      const scope = [
        context.tab,
        context.inboxIds?.join(',') ?? '*',
        activeRead.join(','),
      ].join('|');
      const selection = { ...context.facets, read: [] };
      const matchesOtherFacets = (email: EmailEntity) =>
        testFacets(selection, EMAIL_FACETS, email, undefined);

      // Without a read filter there is nothing to admit, so no ids are kept.
      if (activeRead.length === 0) {
        return {
          scope,
          admittedIds: new Set<string>(),
          items: emails.filter(matchesOtherFacets),
        };
      }

      const admittedIds =
        previous.scope === scope
          ? new Set(previous.admittedIds)
          : new Set<string>();
      const readSelection = { read: activeRead };
      for (const email of emails) {
        if (testFacets(readSelection, EMAIL_FACETS, email, undefined)) {
          admittedIds.add(email.id);
        }
      }

      return {
        scope,
        admittedIds,
        items: emails.filter(
          (email) => admittedIds.has(email.id) && matchesOtherFacets(email)
        ),
      };
    },
    { scope: '', admittedIds: new Set<string>(), items: [] }
  );

  const listEntities = createMemo((): WithNotification<EntityData>[] =>
    entities().items.map((email) =>
      withEntityNotifications(email, notificationSource)
    )
  );

  const usesServiceSearch = search.usesServiceSearch;

  const hasMore = () => {
    if (usesServiceSearch()) return search.hasNextPage();
    return query.hasNextPage;
  };

  const isLoadingMore = () => {
    if (usesServiceSearch()) return search.isFetchingNextPage();
    return query.isFetchingNextPage;
  };

  const items = createMemo<EmailDataSourceItem[]>(() => {
    // Search results keep their relevance order, so only the list page is
    // bucketed by date.
    const result: EmailDataSourceItem[] = search.isSearching()
      ? buildFlatSoupRows(listEntities())
      : buildGroupedSoupRows(groupEmailEntitiesByDate(listEntities()));

    if (hasMore()) {
      result.push(
        createSoupLoadMoreRow({
          scopeId: `email:${state.tab}`,
          isLoading: isLoadingMore(),
        })
      );
    }

    return result;
  });

  const isLoading = () => {
    if (!search.isSearching()) {
      return query.isLoading && rawEntities().length === 0;
    }
    if (entities().items.length > 0) return false;
    if (usesServiceSearch()) return search.isLoading();
    return query.isLoading;
  };

  return {
    items,
    isLoading,
    isFetching: () => {
      if (search.isSettling()) return true;
      return usesServiceSearch() ? search.isFetching() : query.isFetching;
    },
    error: () => {
      if (!usesServiceSearch()) return query.error ?? undefined;
      return search.error();
    },
    hasMore,
    isLoadingMore,
    loadMore: async () => {
      if (usesServiceSearch()) {
        await search.fetchNextPage();
        return;
      }
      await query.fetchNextPage();
    },
    refresh: async () => {
      if (usesServiceSearch()) {
        await search.refetch();
        return;
      }
      await query.refresh();
    },
  } satisfies EmailDataSource;
}
