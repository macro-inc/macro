import { throwOnErr } from '@core/util/result';
import { getWebOrigin } from '@core/util/webOrigin';
import { authServiceClient } from '@service-auth/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { queryReadyGate } from '../gate';
import {
  assertQueryAccount,
  currentQueryAccount,
  type QueryAccount,
} from './account-scope';
import { authKeys } from './keys';
import { useQueryAccount } from './use-query-account';

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
const emailConnectionProvidersQuery = (
  account: QueryAccount | undefined,
  includeAdminConsent = true
) =>
  queryOptions({
    queryKey: [
      ...authKeys.emailConnectionProviders(account?.userId, account?.session)
        .queryKey,
      includeAdminConsent ? 'admin-consent' : 'providers',
    ],
    queryFn: async () => {
      assertQueryAccount(account);
      const result = await throwOnErr(() =>
        authServiceClient.emailConnectionProviders(
          includeAdminConsent ? adminConsentReturnUrl() : undefined
        )
      );
      assertQueryAccount(account);
      return result;
    },
    staleTime: 0,
  });

/**
 * The chooser needs capabilities only, not a signed admin-consent redirect.
 * Leave its optional callback out so capability discovery works from an
 * authenticated local proxy as well as from the configured OAuth origin.
 */
export function fetchEmailConnectionProviders() {
  return queryClient.fetchQuery(
    emailConnectionProvidersQuery(currentQueryAccount(), false)
  );
}

/**
 * Whether to offer a new Outlook connection. False until the server says
 * this user may start one, so Outlook never shows while loading or after a
 * failed read. `enabled` defers the read for surfaces mounted before they open.
 */
export function useOutlookAvailable(
  enabled: Accessor<boolean> = () => true
): Accessor<boolean> {
  const providers = useEmailConnectionProviders(enabled);
  return () => !!providers()?.outlook;
}

export function useImapAvailable(
  enabled: Accessor<boolean> = () => true
): Accessor<boolean> {
  const providers = useEmailConnectionProviders(enabled);
  return () => !!providers()?.imap;
}

export function useEmailConnectionProviders(enabled: Accessor<boolean>) {
  const account = useQueryAccount();
  const query = useQuery(() => ({
    ...emailConnectionProvidersQuery(account()),
    enabled: !!account() && enabled(),
  }));
  // Gate the read: a pending query's data suspends the caller's boundary.
  return () => (account() && queryReadyGate(query) ? query.data : undefined);
}
