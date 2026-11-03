import { debouncedDependent } from '@core/util/debounce';
import type { CacheHost } from '@graphql-cache/host/types';
import { MAX_PEOPLE_BATCH } from '@graphql-cache/people/generated';
import { queryReadyGate } from '@queries/gate';
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import {
  hashKey,
  queryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  type ContactDirectoryCursor,
  type ContactDirectoryHost,
  ContactDirectoryOfflineError,
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
    /** Local eligibility changes also restart paging, without entering IPC. */
    resetKey?: Accessor<string>;
  } = {}
) {
  const owner = createUniqueId();
  const client = useQueryClient();
  const [ownSearch, setSearch] = createSignal('');
  const search = options.search ?? ownSearch;
  const debouncedSearch = debouncedDependent(search, 200);
  const input = createMemo(
    () => {
      const value = options.policy?.();
      if (value && value.excluded.length > MAX_PEOPLE_BATCH)
        throw new Error('Invalid contact policy exclusions');
      const policy = value
        ? {
            mode: value.mode,
            excluded: [...value.excluded],
            senderDomain: value.senderDomain,
          }
        : undefined;
      return {
        query: search(),
        policy,
        policyKey: hashKey([policy, options.resetKey?.()]),
        active: enabled(),
      };
    },
    undefined,
    {
      equals: (previous, next) =>
        previous.query === next.query &&
        previous.policyKey === next.policyKey &&
        previous.active === next.active,
    }
  );
  const [cursor, setCursor] = createSignal<{
    input: ReturnType<typeof input>;
    value: ContactDirectoryCursor;
  }>();
  const [fresh, setFresh] = createSignal<ReturnType<typeof input>>();
  const { epoch: generation, invalidate } = createContactQueryEpoch(
    scope,
    () => {
      setCursor(undefined);
      setFresh(undefined);
    }
  );
  const request = createMemo<ContactDirectoryRequest>(() => {
    const current = cursor();
    const query = debouncedSearch();
    const selection = input();
    const policy = selection.policy;
    return {
      query,
      cursor:
        current?.input === selection &&
        current.value.query === query &&
        current.value.userId === scope().userId
          ? current.value
          : undefined,
      fresh: fresh() === selection,
      ...(policy ? { policy } : {}),
    };
  });
  const query = useQuery(() =>
    contactWindowOptions(
      owner,
      enabled() && search() === debouncedSearch() ? scope().userId : undefined,
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
          if (!enabled()) return;
          const page = untrack(data);
          if (
            page?.source === 'cache' ||
            (!page &&
              untrack(() => query.error) instanceof
                ContactDirectoryOfflineError)
          )
            return query.refetch({ cancelRefetch: false });
        },
        { searchBuckets: () => ['person'] }
      )
    );
  });
  createEffect(
    on(
      () => query.error,
      (error) => {
        if (
          error instanceof ContactDirectoryScopeError &&
          options.policy &&
          untrack(cursor)?.value.source === 'people'
        ) {
          setCursor(undefined);
          invalidate();
        }
      }
    )
  );
  const advance = () => {
    const next = data()?.nextCursor;
    if (!next || !enabled()) return false;
    setFresh(undefined);
    // The input identity changes even when an external query/policy returns to
    // an earlier value. Never revive its old continuation or retain a proxy.
    setCursor({
      input: input(),
      value:
        next.source === 'cache'
          ? { ...next, after: { ...next.after } }
          : { ...next },
    });
    return true;
  };
  return {
    search,
    setSearch: (value: string) => {
      setCursor(undefined);
      setFresh(undefined);
      setSearch(value);
    },
    data,
    windowKey: () =>
      data() ? `${generation()}:${hashKey([request()])}` : undefined,
    loading: () => query.isFetching || search() !== debouncedSearch(),
    error: () => query.error,
    next: () => {
      advance();
    },
    loadNext: async () => {
      if (!advance()) return;
      await client.fetchQuery(
        contactWindowOptions(
          owner,
          scope().userId,
          scope().host,
          generation(),
          request(),
          reader
        )
      );
    },
    restart: () =>
      batch(() => {
        setCursor(undefined);
        setFresh(input());
        invalidate();
      }),
    retry: () => query.refetch({ cancelRefetch: false }),
  };
}
