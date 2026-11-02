import { throwOnErr } from '@core/util/result';
import { getWebOrigin } from '@core/util/webOrigin';
import { authServiceClient } from '@service-auth/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
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

/** Per user: Outlook follows the server's `enable-outlook` flag. */
const emailConnectionProvidersQuery = () =>
  queryOptions({
    queryKey: authKeys.emailConnectionProviders.queryKey,
    queryFn: () =>
      throwOnErr(() =>
        authServiceClient.emailConnectionProviders(adminConsentReturnUrl())
      ),
    staleTime: 0,
  });

/** Fetch on opening the chooser, without suspending unrelated application UI. */
export function fetchEmailConnectionProviders() {
  return queryClient.fetchQuery(emailConnectionProvidersQuery());
}

/**
 * Whether to offer a new Outlook connection. False until the server says
 * this user may start one, so Outlook never shows while loading or after a
 * failed read. `enabled` defers the read for surfaces mounted before they open.
 */
export function useOutlookAvailable(
  enabled: Accessor<boolean> = () => true
): Accessor<boolean> {
  const query = useQuery(() => ({
    ...emailConnectionProvidersQuery(),
    enabled: enabled(),
  }));
  return () => query.data?.outlook === true;
}
