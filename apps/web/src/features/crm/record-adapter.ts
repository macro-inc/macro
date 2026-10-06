import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCrm } from '@core/constant/featureFlags';
import type { EntityItem } from '@core/context/quickAccess';
import { queryReadyGate } from '@queries/gate';
import { storageServiceClient } from '@service-storage/client';
import { useQueryClient } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
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
          page.contacts.map((record) => {
            const contact = toCrmContactEntity(record);
            return {
              kind: 'entity' as const,
              bucket: 'crm_contact' as const,
              id: contact.id,
              data: contact,
              searchText: `${contact.name} | ${contact.email}`,
              sortTimestamp: Date.parse(record.lastInteraction),
              timestamps: { lastInteraction: record.lastInteraction },
            };
          })
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
