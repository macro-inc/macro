import { useQuickAccess } from '@core/context/quickAccess';
import { createEmailsInfiniteQuery, type EntityData } from '@entity';
import { reminderTarget } from '@queries/reminders/reminders';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { Accessor } from 'solid-js';

/** Quick Access does not yet hydrate emails; use the existing email browse/search adapters. */
export function useReminderPickerItems(
  search: Accessor<string>,
  settledSearch: Accessor<string>
) {
  const recent = useQuickAccess().useList({
    buckets: [
      'task',
      'document',
      'note',
      'chat',
      'channel',
      'dm',
      'project',
      'crm_company',
    ],
    searchTerm: search,
  });
  const emails = createEmailsInfiniteQuery(() => ({ view: 'all', limit: 50 }));
  const emailSearch = useSearchSoupQuery(
    () => ({
      params: { page_size: 20 },
      body: {
        query: settledSearch(),
        match_type: 'partial',
        include: ['emails'],
        search_on: 'name',
      },
    }),
    () => ({ enabled: settledSearch().trim().length >= 3 })
  );
  const items = () => {
    const term = search().trim().toLowerCase();
    const browsed = emails.isSuccess
      ? emails.data.filter((email) => email.name.toLowerCase().includes(term))
      : [];
    const searched =
      settledSearch() === search() &&
      emailSearch.isSuccess &&
      !emailSearch.isPlaceholderData
        ? emailSearch.data
        : [];
    const combined: EntityData[] = [
      ...recent.items().map((item) => item.data),
      ...browsed,
      ...searched,
    ];
    const unique = new Map<string, { data: EntityData }>();
    for (const data of combined) {
      if (reminderTarget(data)) unique.set(`${data.type}:${data.id}`, { data });
    }
    return [...unique.values()];
  };
  const searching = () => settledSearch().trim().length >= 3;
  return {
    items,
    isLoading: () =>
      recent.isLoading() || emails.isLoading || emailSearch.isFetching,
    hasMore: () =>
      recent.hasMore() ||
      (searching() ? emailSearch.hasNextPage : emails.hasNextPage),
    isLoadingMore: () =>
      recent.isLoadingMore() ||
      (searching()
        ? emailSearch.isFetchingNextPage
        : emails.isFetchingNextPage),
    loadMore: async () => {
      if (recent.hasMore()) await recent.loadMore();
      if (searching()) {
        if (emailSearch.hasNextPage) await emailSearch.fetchNextPage();
      } else if (emails.hasNextPage) await emails.fetchNextPage();
    },
  };
}
