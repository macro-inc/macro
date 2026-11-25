import type { SearchOperatorLookup } from '@app/features/next-soup/core/search-operator-filters';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { useMailAccountsQuery } from '@queries/email/mail-accounts';
import { queryReadyGate } from '@queries/gate';
import { type Accessor, createMemo } from 'solid-js';
import type { createTagFilter } from './filters-bar/tag-filter-state';

/**
 * What the names typed into Search operators reach, from what the app
 * already holds for the Search filters: the caller's tag options, their
 * inboxes, and the named channels they are in. Names match ignoring case,
 * the whole name, as the search service matches them.
 */
export function createSearchOperatorLookup(
  tagFilter: Pick<ReturnType<typeof createTagFilter>, 'options' | 'defByOption'>
): Accessor<SearchOperatorLookup> {
  const userId = useUserId();
  const linksQuery = useMailAccountsQuery();
  // The channel bucket leaves DMs out, as `in:#` does.
  const channels = useQuickAccess().useList('channel').items;

  return createMemo(() => {
    const tags = tagFilter.options();
    const tagSets = tagFilter.defByOption();
    const links = queryReadyGate(linksQuery) ? linksQuery.data.links : [];
    const named = channels().filter((channel) => channel.data.name);
    return {
      userId: userId() ?? '',
      tags: (name) => {
        const wanted = name.toLowerCase();
        return tags.flatMap((option) => {
          const propertyId = tagSets.get(option.id);
          return option.label.toLowerCase() === wanted && propertyId
            ? [{ propertyId, optionId: option.id }]
            : [];
        });
      },
      inboxes: (address) =>
        links
          .filter((link) => link.email_address.toLowerCase() === address)
          .map((link) => link.id),
      channels: (name) => {
        const wanted = name.toLowerCase();
        return named
          .filter((channel) => channel.data.name.toLowerCase() === wanted)
          .map((channel) => channel.id);
      },
    };
  });
}
