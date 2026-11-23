import type { CacheHost } from '@graphql-cache/host/types';
import { queryReadyGate } from '@queries/gate';
import { hashKey, queryOptions, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo, createUniqueId } from 'solid-js';
import { ContactDirectoryScopeError } from './cache-scope';
import { contactsKeys } from './keys';
import {
  type ContactLookup,
  type ContactLookupHost,
  MAX_CONTACT_LOOKUP,
  resolveContactDirectory,
} from './lookup';
import { createContactQueryEpoch } from './query-epoch';

type LookupQueryHost = ContactLookupHost &
  Pick<CacheHost, 'onCacheGenerationChanged'>;

function contactResolutionOptions(
  owner: string,
  userId: string | undefined,
  host: LookupQueryHost | undefined,
  epoch: number,
  lookup: ContactLookup,
  resolver: typeof resolveContactDirectory
) {
  return queryOptions({
    queryKey: contactsKeys.resolution(
      owner,
      userId ?? '',
      host?.clientId ?? 'network',
      epoch,
      lookup
    ).queryKey,
    enabled: !!userId && lookup.values.length > 0,
    queryFn: async ({ signal }) => {
      if (!userId) throw new Error('Contact lookup requires authentication');
      const resolved = await resolver(userId, host, lookup, signal);
      return {
        userId,
        hostId: host?.clientId,
        epoch,
        input: hashKey([lookup]),
        resolved,
      };
    },
    gcTime: 0,
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnWindowFocus: false,
  });
}

/** Selection is independent of the suggestion window. Unresolved entries must
 * remain selected; they may be external, offline, or absent from a partial cache. */
export function createContactResolution(
  scope: Accessor<{ userId?: string; host?: LookupQueryHost }>,
  lookup: Accessor<ContactLookup>,
  enabled: Accessor<boolean> = () => true,
  resolver: typeof resolveContactDirectory = resolveContactDirectory
) {
  const owner = createUniqueId();
  const { epoch } = createContactQueryEpoch(scope);
  // Snapshot primitive values, not a reactive query/store proxy. Overflow still
  // fails the raw-input bound, without retaining an unbounded input in history.
  const input = createMemo(() => {
    const value = lookup();
    return {
      kind: value.kind,
      values: value.values.slice(0, MAX_CONTACT_LOOKUP + 1),
    };
  });
  const query = useQuery(() =>
    contactResolutionOptions(
      owner,
      enabled() ? scope().userId : undefined,
      scope().host,
      epoch(),
      input(),
      resolver
    )
  );
  const data = () => {
    if (
      !enabled() ||
      query.error instanceof ContactDirectoryScopeError ||
      !queryReadyGate(query)
    )
      return undefined;
    const value = query.data;
    if (
      value.userId !== scope().userId ||
      value.hostId !== scope().host?.clientId ||
      value.epoch !== epoch() ||
      value.input !== hashKey([input()])
    )
      return undefined;
    return value.resolved;
  };
  return {
    data,
    loading: () => query.isFetching,
    error: () => query.error,
    retry: () => query.refetch({ cancelRefetch: false }),
  };
}
