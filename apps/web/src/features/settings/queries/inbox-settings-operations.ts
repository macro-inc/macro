import { throwOnErr } from '@core/util/result';
import { emailKeys } from '@queries/email/keys';
import { emailClient } from '@service-email/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

function inboxSettingsOperationsQueryOptions(linkId: string) {
  return queryOptions({
    queryKey: emailKeys.settingsOperations(linkId).queryKey,
    queryFn: () => throwOnErr(() => emailClient.settingsOperations(linkId)),
    refetchInterval: 5000,
  });
}

export function useInboxSettingsOperations(linkId: Accessor<string>) {
  return useQuery(() => inboxSettingsOperationsQueryOptions(linkId()));
}
