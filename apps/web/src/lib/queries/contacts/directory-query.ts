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
import { openContactReader } from './readers';
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
    /** Lets a first page read the server when the cache has not answered in
     * this long; see `ContactDirectoryRequest.localBudgetMs`. */
    localBudgetMs?: number;
    /** Members of the viewer's team, for server pages to list the ones a
     * typed search names among their first rows. */
    teammates?: Accessor<ReadonlySet<string>>;
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
      // Plain copies: the request outlives the accessor's reactive values.
      const policy: ContactPeoplePolicy | undefined = value
        ? {
            mode: value.mode,
            excluded: [...value.excluded],
            senderDomain: value.senderDomain,
            ...(value.listPriority?.length
              ? { listPriority: value.listPriority.map((group) => [...group]) }
              : {}),
            ...(value.onlyListed ? { onlyListed: true } : {}),
          }
        : undefined;
      // Only a typed search reads its teammates. Browsing leaves the roster
      // out, so one that loads later never restarts its pages.
      const teammates = search().trim()
        ? [...(options.teammates?.() ?? [])].sort()
        : [];
      return {
        query: search(),
        policy,
        teammates,
        policyKey: hashKey([policy, options.resetKey?.(), teammates]),
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
      ...(options.localBudgetMs === undefined
        ? {}
        : { localBudgetMs: options.localBudgetMs }),
      ...(selection.teammates.length ? { teammates: selection.teammates } : {}),
    };
  });
  /** Who the query reads for: nobody until the window is open and its text
   * has settled. */
  const queryUserId = () =>
    enabled() && search() === debouncedSearch() ? scope().userId : undefined;
  const query = useQuery(() =>
    contactWindowOptions(
      owner,
      queryUserId(),
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

  // Counted as a reader only once its first page settles, so the publisher's
  // catch-up reread never competes with the read that lists the first rows.
  createEffect(() => {
    if (!enabled()) return;
    let release: (() => void) | undefined;
    createEffect(() => {
      if (!release && !query.isPending) release = openContactReader();
    });
    onCleanup(() => release?.());
  });
  const budgeted = options.localBudgetMs !== undefined;
  const rereadAfterCacheChange = () => {
    // Rows the server listed because the cache was late keep their order
    // until the input changes, on every page: the cache answering afterwards
    // would rank them differently under the cursor.
    const continuation = untrack(request).cursor;
    if (
      untrack(data)?.localLate ||
      (continuation?.source === 'server' && continuation.localLate)
    )
      return;
    const error = untrack(() => query.error);
    if (!error || error instanceof ContactDirectoryUnavailableError) {
      // A reply from before this write must not publish under the same
      // input again. Restart keyset paging against the new local version.
      batch(() => {
        setCursor(undefined);
        invalidate();
      });
    }
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
          // A read with a budget is not restarted while it runs: a cache busy
          // enough to be late also reports changes, and each restart would
          // give it a new budget and never reach the server. Its page is
          // refreshed by the next change after it lands; re-reading the
          // moment it lands would take its rows away again as they appear.
          if (budgeted && untrack(() => query.isFetching)) return;
          rereadAfterCacheChange();
        },
        { searchBuckets: () => ['person'] }
      )
    );
  });
  createEffect(
    on(
      () => query.error,
      (error) => {
        // A continuation from another source or generation restarts paging.
        if (error instanceof ContactDirectoryScopeError && untrack(cursor)) {
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
    /** From the first keystroke until the page for that text lands, with no
     * gap: a list that keeps rows while loading drops them in a gap. While
     * the text settles the query sits on a disabled key, pending and idle,
     * and a computation that runs before the query takes up the settled
     * text's key still sees that state. */
    loading: () =>
      query.isFetching ||
      search() !== debouncedSearch() ||
      (!!queryUserId() && query.isPending),
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
