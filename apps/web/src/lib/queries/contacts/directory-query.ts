import { debouncedDependent } from '@core/util/debounce';
import type { CacheHost } from '@graphql-cache/host/types';
import { MAX_PEOPLE_BATCH } from '@graphql-cache/people/generated';
import { queryReadyGate } from '@queries/gate';
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import { hashKey, queryOptions, useQuery } from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  type ContactDirectoryCursor,
  type ContactDirectoryHost,
  type ContactDirectoryRequest,
  ContactDirectoryScopeError,
  type ContactPeoplePolicy,
  readContactDirectory,
} from './directory';
import { contactsKeys } from './keys';
import { createContactQueryEpoch } from './query-epoch';

export type ContactWindowHost = ContactDirectoryHost &
  Pick<CacheHost, 'onCacheChanged' | 'onCacheGenerationChanged'>;

/** Scoped per observer and immediately collected: queries/cursors are not a
 * historical directory cache, and no callback retains component accessors. */
function contactWindowOptions(
  owner: string,
  userId: string | undefined,
  host: ContactWindowHost | undefined,
  generation: number,
  request: ContactDirectoryRequest,
  reader: typeof readContactDirectory
) {
  return queryOptions({
    queryKey: contactsKeys.window(
      owner,
      userId ?? '',
      host?.clientId ?? 'network',
      generation,
      request
    ).queryKey,
    queryFn: async ({ signal }) => {
      if (!userId) throw new Error('Contact directory requires authentication');
      const page = await reader(userId, host, request, signal);
      return {
        userId,
        hostId: host?.clientId,
        generation,
        requestKey: hashKey([request]),
        page,
      };
    },
    enabled: !!userId,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnWindowFocus: false,
  });
}

/** Owns a single replaceable result window, never an appended page history. */
export function createContactDirectoryWindow(
  scope: Accessor<{ userId?: string; host?: ContactWindowHost }>,
  reader: typeof readContactDirectory = readContactDirectory,
  enabled: Accessor<boolean> = () => true,
  options: {
    search?: Accessor<string>;
    policy?: Accessor<ContactPeoplePolicy>;
  } = {}
) {
  const owner = createUniqueId();
  const [ownSearch, setSearch] = createSignal('');
  const search = options.search ?? ownSearch;
  const debouncedSearch = debouncedDependent(search, 200);
  const [cursor, setCursor] = createSignal<ContactDirectoryCursor>();
  const [fresh, setFresh] = createSignal(false);
  const { epoch: generation, invalidate } = createContactQueryEpoch(
    scope,
    () => {
      setCursor(undefined);
      setFresh(false);
    }
  );
  const request = createMemo<ContactDirectoryRequest>(() => {
    const current = cursor();
    const query = debouncedSearch();
    const inputPolicy = options.policy?.();
    if (inputPolicy && inputPolicy.excluded.length > MAX_PEOPLE_BATCH)
      throw new Error('Invalid contact policy exclusions');
    const policy = inputPolicy
      ? {
          mode: inputPolicy.mode,
          excluded: [...inputPolicy.excluded],
          senderDomain: inputPolicy.senderDomain,
        }
      : undefined;
    const policyMatches =
      current?.source === 'cache'
        ? !policy
        : current?.policyKey === (policy ? hashKey([policy]) : undefined);
    return {
      query,
      cursor:
        current?.query === query &&
        current.userId === scope().userId &&
        policyMatches
          ? current
          : undefined,
      fresh: fresh(),
      ...(policy ? { policy } : {}),
    };
  });
  const query = useQuery(() =>
    contactWindowOptions(
      owner,
      enabled() ? scope().userId : undefined,
      scope().host,
      generation(),
      request(),
      reader
    )
  );
  const data = () => {
    if (
      !enabled() ||
      query.error instanceof ContactDirectoryScopeError ||
      !queryReadyGate(query)
    )
      return undefined;
    const result = query.data;
    if (
      result.requestKey !== hashKey([request()]) ||
      result.page.query !== search() ||
      result.userId !== scope().userId ||
      result.hostId !== scope().host?.clientId ||
      result.generation !== generation()
    )
      return undefined;
    return result.page;
  };

  createEffect(() => {
    const host = scope().host;
    if (!host) return;
    onCleanup(
      subscribeToVisibleCacheChanges(
        host,
        () => {
          // Do not re-fetch the network for every background hydration page. A
          // server continuation stays on its original source until Restart.
          if (untrack(data)?.source === 'cache')
            return query.refetch({ cancelRefetch: false });
        },
        { searchBuckets: () => ['person'] }
      )
    );
  });
  return {
    search,
    setSearch: (value: string) => {
      setCursor(undefined);
      setFresh(false);
      setSearch(value);
    },
    data,
    windowKey: () =>
      data() ? `${generation()}:${hashKey([request()])}` : undefined,
    loading: () => query.isFetching || search() !== debouncedSearch(),
    error: () => query.error,
    next: () => {
      const next = data()?.nextCursor;
      if (next) {
        setFresh(false);
        // Query data is a Solid store. Retain plain cursor values, not a proxy
        // tied to the previous result/window or its owner.
        setCursor(
          next.source === 'cache'
            ? { ...next, after: { ...next.after } }
            : { ...next }
        );
      }
    },
    restart: () =>
      batch(() => {
        setCursor(undefined);
        setFresh(true);
        invalidate();
      }),
    retry: () => query.refetch({ cancelRefetch: false }),
  };
}
