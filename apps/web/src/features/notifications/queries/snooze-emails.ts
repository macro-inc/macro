import { createEmailsInfiniteQuery } from '@entity/queries/email';
import type { EmailEntity } from '@entity/types/entity';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { Accessor } from 'solid-js';

/** Email threads are not supplied by Quick Access. */
export function useSnoozeEmails(
  searchTerm: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const emails = createEmailsInfiniteQuery(() => ({ view: 'all', limit: 50 }), {
    disabled: () => !enabled(),
  });
  const search = useSearchSoupQuery(
    () => ({
      params: { page_size: 50 },
      body: {
        query: searchTerm(),
        match_type: 'partial',
        include: ['emails'],
        search_on: 'name',
      },
    }),
    () => ({ enabled: enabled() })
  );

  const items = (): EmailEntity[] => {
    const term = searchTerm().trim().toLowerCase();
    const local = emails.isSuccess
      ? emails.data.filter((email) => email.name.toLowerCase().includes(term))
      : [];
    // The shared search query retains the previous term's data while fetching.
    const remote =
      search.isEnabled && search.isSuccess && !search.isPlaceholderData
        ? search.data.filter((entity) => entity.type === 'email')
        : [];
    return [
      ...new Map(
        [...remote, ...local].map((email) => [email.id, email])
      ).values(),
    ];
  };

  return {
    items,
    isLoading: () => emails.isLoading || search.isFetching,
    hasMore: () =>
      (search.isEnabled ? search.hasNextPage : emails.hasNextPage) ?? false,
    async loadMore() {
      const query = search.isEnabled ? search : emails;
      if (query.hasNextPage && !query.isFetching) await query.fetchNextPage();
    },
  };
}
