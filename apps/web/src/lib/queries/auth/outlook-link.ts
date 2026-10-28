import { throwOnErr } from '@core/util/result';
import { getWebOrigin } from '@core/util/webOrigin';
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

/**
 * Where a Microsoft administrator lands after approving Macro. Always the web
 * app: the link is copied for someone else, often on another device, so a
 * desktop deep link or native callback would not reach them.
 */
const adminConsentReturnUrl = () => `${getWebOrigin()}/app/inbox-link-callback`;

/** Fetch on opening the chooser, without suspending unrelated application UI. */
export function fetchEmailConnectionProviders() {
  return queryClient.fetchQuery({
    queryKey: authKeys.emailConnectionProviders.queryKey,
    queryFn: () =>
      throwOnErr(() =>
        authServiceClient.emailConnectionProviders(adminConsentReturnUrl())
      ),
    staleTime: 0,
  });
}
