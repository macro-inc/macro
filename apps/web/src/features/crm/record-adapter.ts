import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCrm } from '@core/constant/featureFlags';
import type { EntityItem } from '@core/context/quickAccess';
import { useQuickAccess } from '@core/context/quickAccess/context';
import { toCrmContactItem } from '@core/context/quickAccess/crm-contacts';
import { debouncedDependent } from '@core/util/debounce';
import { isCrmContactEntity } from '@entity/types/entity';
import { queryReadyGate } from '@queries/gate';
import { storageServiceClient } from '@service-storage/client';
import { useQueryClient } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { createContactDiscovery } from './primitives/contact-discovery';
import { useSetCompanyHiddenMutation as createHiddenMutation } from './queries/companies';
import {
  useQuickAccessCrmContactsQuery as createContactSuggestions,
  useCrmContactsQuery,
} from './queries/contact-suggestions';
import { useCrmContactByEmailQuery as createContactByEmailQuery } from './queries/contacts';
import { toCrmContactEntity } from './queries/graphql';

/** CRM record capabilities used by app-wide entity actions and user cards. */
export function useSetCompanyHiddenMutation() {
  return createHiddenMutation({
    storage: storageServiceClient,
    client: useQueryClient(),
  });
}
export function useCrmContactByEmailQuery(
  teamId: Accessor<string>,
  email: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return createContactByEmailQuery(
    { storage: storageServiceClient, client: useQueryClient() },
    teamId,
    email,
    enabled
  );
}

/** Quick Access feed of visible contacts across the viewer's CRM-enabled teams. */
export function useQuickAccessCrmContactsQuery() {
  const flag = useFeatureFlag(enableCrm);
  return createContactSuggestions(
    { storage: storageServiceClient, client: useQueryClient() },
    () => flag().enabled
  );
}

export { materializeCachedGraphqlCrmContacts } from './queries/graphql';

/** Server-filtered mention results include contacts beyond the initial cache feed. */
export function useCrmContactMentionSource(
  search: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const query = useCrmContactsQuery(
    { client: useQueryClient() },
    enabled,
    search
  );
  const entities = createMemo<EntityItem[]>(() =>
    queryReadyGate(query)
      ? query.data.pages.flatMap((page) =>
          page.contacts.map((record) =>
            toCrmContactItem(toCrmContactEntity(record))
          )
        )
      : []
  );
  return {
    entities,
    totalCount: () => entities().length,
    hasMore: () => !!query.hasNextPage,
    isLoading: () => query.isLoading,
    isLoadingMore: () => query.isFetchingNextPage,
    loadMore: async () => {
      await query.fetchNextPage();
    },
  };
}

const CONTACT_SEARCH_DEBOUNCE_MS = 250;

/** Contacts matching a typed query: cached matches at once, then authorized
 * server pages across the viewer's CRM-enabled teams beyond the cached rows. */
export function useCrmContactDiscovery(
  search: Accessor<string>,
  active: Accessor<boolean>
) {
  const flag = useFeatureFlag(enableCrm);
  const query = () => search().trim();
  const enabled = () => flag().enabled && active() && query().length > 0;
  const serverQuery = debouncedDependent(query, CONTACT_SEARCH_DEBOUNCE_MS);
  const cached = useQuickAccess().useList({
    buckets: ['crm_contact'],
    searchTerm: query,
    enabled,
  });
  const server = useCrmContactsQuery(
    { client: useQueryClient() },
    () => enabled() && serverQuery().length > 0,
    serverQuery
  );
  return createContactDiscovery({
    query,
    active: enabled,
    cached: {
      contacts: () =>
        cached
          .items()
          .flatMap((item) =>
            item.kind === 'entity' && isCrmContactEntity(item.data)
              ? [item.data]
              : []
          ),
      isLoading: cached.isLoading,
      hasMore: cached.hasMore,
      isLoadingMore: cached.isLoadingMore,
      loadMore: cached.loadMore,
    },
    server: {
      query: serverQuery,
      contacts: () =>
        queryReadyGate(server)
          ? server.data.pages.flatMap((page) =>
              page.contacts.map(toCrmContactEntity)
            )
          : undefined,
      error: () => server.error ?? undefined,
      isLoading: () => server.isLoading,
      hasMore: () => server.hasNextPage,
      isLoadingMore: () => server.isFetchingNextPage,
      loadMore: async () => {
        await server.fetchNextPage();
      },
      refresh: async () => {
        await server.refetch({ throwOnError: true });
      },
    },
  });
}
