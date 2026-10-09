import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { authKeys } from './keys';

/** OAuth transport stays in the auth client, shared query orchestration here. */
export function useInitOutlookLink() {
  return useMutation(() => ({
    mutationFn: (params: {
      originalUrl: string;
      calendar: boolean;
      reconnectLinkId?: string;
    }) => authServiceClient.initOutlookLink(params.originalUrl, params),
  }));
}

/** Fetch on opening the chooser, without suspending unrelated application UI. */
export function fetchEmailConnectionProviders() {
  return queryClient.fetchQuery({
    queryKey: authKeys.emailConnectionProviders.queryKey,
    queryFn: () =>
      throwOnErr(() => authServiceClient.emailConnectionProviders()),
    staleTime: 0,
  });
}
