import { useChannelsContext } from '@core/context/channels';
import {
  type CombinedEntity,
  createEntitySearchConfig,
  entityMapper,
  getEntitySearchText,
  getEntityTimestampedItem,
  isChannelEntity,
  threadMapper,
} from '@core/component/Properties/component/modal/shared/entityUtils';
import { useAugmentUserWithDmActivity, useContacts } from '@core/user';
import { createFreshSearch } from '@core/util/freshSort';
import { useEmail } from '@core/context/user';
import { createEmailsInfiniteQuery } from '@macro-entity';
import type { EmailEntity } from '@entity';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { useHistoryQuery } from '@queries/history/history';
import { debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createMemo,
  createSignal,
  type Accessor,
} from 'solid-js';
import type {
  Property,
  PropertyDefinitionDomain,
} from '@core/component/Properties/types';

export function useEntitiesForProperty(
  property: Accessor<Property | PropertyDefinitionDomain | undefined>,
  searchQuery: Accessor<string>
) {
  const [searchTerm, setSearchTerm] = createSignal('');

  // Debounce search term updates
  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term.toLowerCase()),
    60
  );
  createEffect(() => debouncedSetSearchTerm(searchQuery()));

  // Data sources
  const contacts = useContacts();
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;
  const historyQuery = useHistoryQuery();
  const history = () => historyQuery.data ?? [];

  const specificEntityType = () => property()?.specificEntityType;

  // Email queries for THREAD type or generic ENTITY (no specific type)
  const needsEmailSearch = () =>
    specificEntityType() === 'THREAD' || !specificEntityType();

  const emailsQuery = createEmailsInfiniteQuery(() => ({ view: 'all' }), {
    disabled: () => !needsEmailSearch(),
  });
  const emails = () => emailsQuery.data ?? [];

  // Server-side email search
  const emailSearchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: 20 },
      body: {
        query: searchTerm(),
        match_type: 'partial' as const,
        include: ['emails' as const],
        search_on: 'name' as const,
      },
    }),
    () => ({
      enabled: needsEmailSearch() && !!searchTerm(),
    })
  );

  // Server search results mapped to our format
  const serverEmails = createMemo((): CombinedEntity[] => {
    if (emailSearchQuery.status !== 'success' || !emailSearchQuery.data) {
      return [];
    }
    return emailSearchQuery.data
      .filter((entity) => entity.type === 'email')
      .map((entity) => threadMapper(entity as EmailEntity));
  });

  // Helper to augment user entities with DM activity timestamps (same as MentionsMenu)
  const augmentUserWithDmActivity = useAugmentUserWithDmActivity();
  const augmentUsersWithDmActivity = (): CombinedEntity[] => {
    return contacts().map((user) =>
      entityMapper('user')(augmentUserWithDmActivity(user))
    );
  };

  // Get entities based on specific entity type
  const entities = createMemo((): CombinedEntity[] => {
    const entityType = specificEntityType();

    // Generic entity - include all types
    if (!entityType) {
      return [
        ...augmentUsersWithDmActivity(),
        ...history().map(entityMapper('item')),
        ...channels().map(entityMapper('channel')),
        ...emails().map(threadMapper),
      ];
    }

    if (entityType === 'USER') {
      return augmentUsersWithDmActivity();
    }

    if (entityType === 'CHANNEL') {
      return channels().map(entityMapper('channel'));
    }

    if (entityType === 'THREAD') {
      return emails().map(threadMapper);
    }

    // Item-based types: DOCUMENT, PROJECT, CHAT
    const itemTypes: EntityType[] = ['DOCUMENT', 'PROJECT', 'CHAT'];
    if (itemTypes.includes(entityType)) {
      return history()
        .filter((item) => item.type.toUpperCase() === entityType)
        .map(entityMapper('item'));
    }

    if (entityType === 'TASK') {
      return history()
        .filter(
          (item) => item.type === 'document' && item.subType?.type === 'task'
        )
        .map(entityMapper('item'));
    }

    // COMPANY not yet implemented
    return [];
  });

  const currentUserEmail = useEmail();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  // search function for fuzzy matching
  const entitySearch = createFreshSearch<CombinedEntity>(
    createEntitySearchConfig(currentUserDomain),
    getEntitySearchText,
    isChannelEntity,
    getEntityTimestampedItem
  );

  // get filtered entities based on search query
  const filteredEntities = createMemo(() => {
    const query = searchTerm();
    const available = entities();

    const MAX_RESULTS = 50;

    const localResults = entitySearch(available, query)
      .slice(0, MAX_RESULTS)
      .map((result) => result.item);

    if (needsEmailSearch() && query) {
      const localIds = new Set(localResults.map((e) => e.id));
      const serverResults = serverEmails().filter((e) => !localIds.has(e.id));
      return [...localResults, ...serverResults].slice(0, MAX_RESULTS);
    }

    return localResults;
  });

  return {
    entities: filteredEntities,
  };
}
