import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCrm } from '@core/constant/featureFlags';
import { storageServiceClient } from '@service-storage/client';
import { useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { useSetCompanyHiddenMutation as createHiddenMutation } from './queries/companies';
import { useQuickAccessCrmContactsQuery as createContactSuggestions } from './queries/contact-suggestions';
import { useCrmContactByEmailQuery as createContactByEmailQuery } from './queries/contacts';

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

/** Quick Access feed of the team's CRM contacts, while the CRM is enabled. */
export function useQuickAccessCrmContactsQuery() {
  const flag = useFeatureFlag(enableCrm);
  return createContactSuggestions(
    { storage: storageServiceClient, client: useQueryClient() },
    () => flag().enabled
  );
}
