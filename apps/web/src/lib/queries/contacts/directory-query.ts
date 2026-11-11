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
  type ContactDirectoryRequest,
  ContactDirectoryScopeError,
  ContactDirectoryUnavailableError,
  type ContactPeoplePolicy,
  readContactDirectory,
} from './directory';
import { contactsKeys } from './keys';
import { createContactQueryEpoch } from './query-epoch';
import { requestContactRefresh } from './refresh';

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
      host?.clientId ?? 'unavailable',
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
    /** Wait this long after the last search edit before reading. Callers
     * whose search text is already debounced pass 0. */
    debounceMs?: number;
  } = {}
) {
  const owner = createUniqueId();
  const client = useQueryClient();
  const [ownSearch, setSearch] = createSignal('');
  const search = options.search ?? ownSearch;
  const debouncedSearch = debouncedDependent(search, options.debounceMs ?? 200);
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
  const { epoch: generation, invalidate } = createContactQueryEpoch(
    scope,
    () => {
      setCursor(undefined);
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
      query.error instanceof ContactDirectoryUnavailableError ||
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
          // Re-read locally as synchronization/context publication progresses.
          if (!enabled()) return;
          const error = untrack(() => query.error);
          if (!error || error instanceof ContactDirectoryUnavailableError) {
            // A reply from before this write must not publish under the same
            // input again. Restart keyset paging against the new local version.
            batch(() => {
              setCursor(undefined);
              invalidate();
            });
          }
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
    // The input identity changes even when an external query/policy returns to
    // an earlier value. Never revive its old continuation or retain a proxy.
    setCursor({
      input: input(),
      value: { ...next },
    });
    return true;
  };
  return {
    /** Stable across pages, but changes with eligibility, scope and activation. */
    inputKey: () =>
      hashKey([generation(), input().query, input().policyKey, input().active]),
    search,
    setSearch: (value: string) => {
      setCursor(undefined);
      setSearch(value);
    },
    data,
    /** Whether the page on screen continues an earlier one. */
    continued: () => request().cursor !== undefined,
    /** Names the page on screen (query, eligibility, continuation). A refresh
     * of that page keeps its key, so callers reset focus only for a new page. */
    windowKey: () => (data() ? hashKey([request()]) : undefined),
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
        requestContactRefresh();
        invalidate();
      }),
    retry: () => query.refetch({ cancelRefetch: false }),
  };
}
