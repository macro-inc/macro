import { throwOnErr } from '@core/util/result';
import { emailKeys } from '@queries/email/keys';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export function useInboxSettingsOperations(linkId: Accessor<string>) {
  const operations = useQuery(() => ({
    queryKey: emailKeys.settingsOperations(linkId()).queryKey,
    queryFn: () => throwOnErr(() => emailClient.settingsOperations(linkId())),
    refetchInterval: 5000,
  }));
  return operations;
}
