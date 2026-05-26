import { useEmail, useUserId } from '@core/context/user';
import { useAugmentUserWithDmActivity } from '@core/user';
import { createFreshSearch } from '@core/util/freshSort';
import type { EmailEntity } from '@entity';
import { createEmailsInfiniteQuery } from '@macro-entity';
import {
  type CombinedEntity,
  createEntitySearchConfig,
  getEntitySearchText,
  getEntityTimestampedItem,
  getEntityType,
  isChannelEntity,
  quickAccessItemToEntity,
  sortEntitiesWithSelfFirst,
  threadMapper,
  useQuickAccessEntities,
  userToEntity,
} from '@property';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { useSearchSoupQuery } from '@queries/soup/search';
import { debounce } from '@solid-primitives/scheduled';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';

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

  const augmentUserWithDmActivity = useAugmentUserWithDmActivity();

  // Get current user info for same-domain boost and self-boost in search
  const currentUserEmail = useEmail();
  const currentUserId = useUserId();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  const specificEntityType = () => property()?.specificEntityType;

  // Get items from quickAccess based on entity type
  const { items: quickAccessItems } =
    useQuickAccessEntities(specificEntityType);

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

  // Convert quickAccess items to CombinedEntity format
  const entities = createMemo((): CombinedEntity[] => {
    const entityType = specificEntityType();

    // For THREAD type, use email data (not in quickAccess yet)
    if (entityType === 'THREAD') {
      return emails().map(threadMapper);
    }

    // For COMPANY type, return empty (not in quickAccess)
    if (entityType === 'COMPANY') {
      return [];
    }

    // Convert quickAccess items to CombinedEntity
    const items = quickAccessItems();
    const converted: CombinedEntity[] = [];

    for (const item of items) {
      // Augment users with DM activity
      if (item.kind === 'user') {
        const augmentedUser = augmentUserWithDmActivity(item.data);
        converted.push(userToEntity(augmentedUser));
      } else {
        const entity = quickAccessItemToEntity(item);
        // Filter by specific entity type if needed
        if (entityType) {
          const type = getEntityType(entity);
          if (type === entityType) {
            converted.push(entity);
          }
        } else {
          converted.push(entity);
        }
      }
    }

    // For generic entity type, also include emails
    if (!entityType) {
      converted.push(...emails().map(threadMapper));
    }

    return converted;
  });

  // search function for fuzzy matching
  const entitySearch = createFreshSearch<CombinedEntity>({
    config: createEntitySearchConfig(currentUserDomain, currentUserId),
    getName: getEntitySearchText,
    isChannelItem: isChannelEntity,
    getTimestamp: getEntityTimestampedItem,
  });

  // get filtered entities based on search query
  const filteredEntities = createMemo(() => {
    const query = searchTerm();
    const available = entities();
    const userId = currentUserId();

    const MAX_RESULTS = 50;

    // When no search query, sort self to top BEFORE slicing
    if (!query) {
      return sortEntitiesWithSelfFirst(available, userId).slice(0, MAX_RESULTS);
    }

    const localResults = entitySearch(available, query)
      .slice(0, MAX_RESULTS)
      .map((result) => result.item);

    if (needsEmailSearch()) {
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
