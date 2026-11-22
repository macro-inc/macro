import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { disableCrmContactSearch } from '@core/constant/featureFlags';
import { useDmActivityByUserId } from '@core/context/channels';
import type { EntityItem } from '@core/context/quickAccess';
import { useQuickAccess } from '@core/context/quickAccess/context';
import { toCrmContactItem } from '@core/context/quickAccess/crm-contacts';
import { contactUserItem } from '@core/context/quickAccess/person-items';
import { debouncedDependent } from '@core/util/debounce';
import { isCrmContactEntity } from '@entity/types/entity';
import { createContactAliasWindow } from '@queries/contacts/alias-window';
import { queryReadyGate } from '@queries/gate';
import { storageServiceClient } from '@service-storage/client';
import { crmAccessAllowed } from '@service-storage/crm-access-authority';
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
    () => enabled() && crmAccessAllowed()
  );
}

/** Quick Access feed of visible contacts across the viewer's CRM-enabled teams. */
export function useQuickAccessCrmContactsQuery() {
  return createContactSuggestions(
    { storage: storageServiceClient, client: useQueryClient() },
    crmAccessAllowed
  );
}

export { materializeCachedGraphqlCrmContacts } from './queries/graphql';

/** Server-filtered mention results include contacts beyond the initial cache feed. */
export function useCrmContactMentionSource(
  search: Accessor<string>,
  enabled: Accessor<boolean>,
  resolveUsers: Accessor<boolean> = () => true
) {
  const query = useCrmContactsQuery(
    { client: useQueryClient() },
    () => enabled() && crmAccessAllowed(),
    search
  );
  const entities = createMemo<EntityItem[]>(() =>
    crmAccessAllowed() && queryReadyGate(query)
      ? query.data.pages.flatMap((page) =>
          page.contacts.map((record) =>
            toCrmContactItem(toCrmContactEntity(record))
          )
        )
      : []
  );
  const aliases = createContactAliasWindow({
    rows: entities,
    email: (item) =>
      (item.data.type === 'crm_contact' ? item.data.email : '') ?? '',
    search,
    enabled,
    resolveUsers,
    // A failed page ends paging, so a menu reading on scroll cannot repeat it.
    hasMore: () => !!query.hasNextPage && !query.isFetchNextPageError,
    loadMore: async () => {
      await query.fetchNextPage();
    },
  });
  const activity = useDmActivityByUserId();
  return {
    entities: aliases.rows,
    windowKey: aliases.windowKey,
    users: () =>
      aliases
        .users()
        .map((user) =>
          contactUserItem({ ...user, lastInteraction: activity().get(user.id) })
        ),
    totalCount: () => aliases.rows().length,
    hasMore: aliases.hasMore,
    isLoading: () => query.isLoading || aliases.loading(),
    isLoadingMore: () => query.isFetchingNextPage || aliases.isLoadingMore(),
    loadMore: aliases.loadMore,
    error: () => query.error ?? undefined,
    // A failed later page is the next one to read; a failed first page is
    // read from the start.
    retry: async () => {
      if (query.isFetchNextPageError) await query.fetchNextPage();
      else await query.refetch();
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
  const contactSearchDisabled = useFeatureFlag(disableCrmContactSearch);
  const query = () => search().trim();
  const enabled = () =>
    crmAccessAllowed() &&
    !contactSearchDisabled().enabled &&
    active() &&
    query().length > 0;
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
  const discovery = createContactDiscovery({
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
      answer: () =>
        queryReadyGate(server)
          ? {
              query: server.data.pages[0]?.search ?? '',
              contacts: server.data.pages.flatMap((page) =>
                page.contacts.map(toCrmContactEntity)
              ),
            }
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
  const aliases = createContactAliasWindow({
    rows: discovery.contacts,
    email: (contact) => contact.email ?? '',
    search: query,
    enabled,
    hasMore: discovery.hasMore,
    loadMore: discovery.loadMore,
  });
  const activity = useDmActivityByUserId();
  return {
    ...discovery,
    contacts: aliases.rows,
    windowKey: aliases.windowKey,
    users: () =>
      aliases
        .users()
        .map((user) =>
          contactUserItem({ ...user, lastInteraction: activity().get(user.id) })
        ),
    isLoading: () => discovery.isLoading() || aliases.loading(),
    error: () => discovery.error() ?? aliases.error() ?? undefined,
    hasMore: aliases.hasMore,
    isLoadingMore: () => discovery.isLoadingMore() || aliases.isLoadingMore(),
    loadMore: aliases.loadMore,
  };
}
