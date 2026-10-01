import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCrm } from '@core/constant/featureFlags';
import type { CrmContactEntity } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import { useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { useSetCompanyHiddenMutation as createHiddenMutation } from './queries/companies';
import {
  useCrmContactByEmailQuery as createContactByEmailQuery,
  useCrmContactSearchQuery as createContactSearchQuery,
} from './queries/contacts';

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

/**
 * Team CRM contacts whose email or name contains `query`, as entities for
 * pickers. Empty until the search resolves.
 */
export function useCrmContactSearch(
  query: Accessor<string>,
  enabled: Accessor<boolean>
): Accessor<CrmContactEntity[]> {
  const flag = useFeatureFlag(enableCrm);
  const search = createContactSearchQuery(
    { storage: storageServiceClient, client: useQueryClient() },
    query,
    () => flag().enabled && enabled()
  );
  // Read data only once resolved so pickers never suspend on the search.
  return () =>
    (search.status === 'success' ? search.data : []).map((contact) => ({
      type: 'crm_contact',
      id: contact.id,
      name: contact.name || contact.email,
      ownerId: '',
      companyId: contact.companyId,
      email: contact.email,
      hidden: contact.hidden,
      createdAt: contact.createdAt,
      updatedAt: contact.lastInteraction,
    }));
}
