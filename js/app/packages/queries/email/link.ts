import { useEmail } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { emailKeys } from './keys';

const LINK_STALE_TIME = 5 * 60 * 1000;

export function useEmailLinksQuery() {
  return useQuery(() => ({
    queryKey: emailKeys.links.queryKey,
    queryFn: async () => throwOnErr(async () => await emailClient.getLinks()),
    staleTime: LINK_STALE_TIME,
    refetchOnWindowFocus: 'always',
  }));
}

/**
 * The link id of the user's primary inbox — the linked inbox whose address
 * matches the account email. `undefined` until links/email load or if none match.
 */
export function usePrimaryEmailLinkId() {
  const linksQuery = useEmailLinksQuery();
  const email = useEmail();
  return createMemo(() => {
    const primaryEmail = email()?.toLowerCase();
    if (!primaryEmail) return undefined;
    return linksQuery.data?.links.find(
      (link) => link.email_address.toLowerCase() === primaryEmail
    )?.id;
  });
}

/**
 * Returns a mapper from a target inbox link id to the `X-Email-Link-Id` value a
 * mutation should send: the link id when it targets a non-primary inbox, or
 * `undefined` for the primary inbox (the backend defaults to primary when the
 * header is absent). Use at mutation call sites to scope writes to the inbox the
 * user is acting in.
 */
export function useNonPrimaryEmailLinkIdHeader() {
  const primaryLinkId = usePrimaryEmailLinkId();
  return (linkId: string | undefined | null): string | undefined =>
    !linkId || linkId === primaryLinkId() ? undefined : linkId;
}

export function invalidateEmailLinks() {
  queryClient.cancelQueries({ queryKey: emailKeys.links.queryKey });
  queryClient.invalidateQueries({
    queryKey: emailKeys.links.queryKey,
  });
}
