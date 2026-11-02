import { debouncedDependent } from '@core/util/debounce';
import type { CacheHost } from '@graphql-cache/host/types';
import { queryReadyGate } from '@queries/gate';
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import { queryOptions, useQuery } from '@tanstack/solid-query';
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
  readContactDirectory,
} from './directory';
import { contactsKeys } from './keys';

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
      return { userId, hostId: host?.clientId, generation, page };
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
  reader: typeof readContactDirectory = readContactDirectory
) {
  const owner = createUniqueId();
  const [search, setSearch] = createSignal('');
  const debouncedSearch = debouncedDependent(search, 200);
  const [cursor, setCursor] = createSignal<ContactDirectoryCursor>();
  const [fresh, setFresh] = createSignal(false);
  const [generation, setGeneration] = createSignal(0);
  const request = createMemo<ContactDirectoryRequest>(() => {
    const current = cursor();
    const query = debouncedSearch();
    return {
      query,
      cursor:
        current?.query === query && current.userId === scope().userId
          ? current
          : undefined,
      fresh: fresh(),
    };
  });
  const query = useQuery(() =>
    contactWindowOptions(
      owner,
      scope().userId,
      scope().host,
      generation(),
      request(),
      reader
    )
  );
  const data = () => {
    if (
      query.error instanceof ContactDirectoryScopeError ||
      !queryReadyGate(query)
    )
      return undefined;
    const result = query.data;
    if (
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
      host.onCacheGenerationChanged(() => {
        setCursor(undefined);
        setGeneration((value) => value + 1);
      })
    );
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
  // An account/host change cannot resurrect its old page when switching back.
  let previousScope = untrack(scope);
  createEffect(() => {
    const current = scope();
    if (
      current.userId !== previousScope.userId ||
      current.host !== previousScope.host
    ) {
      batch(() => {
        setCursor(undefined);
        setFresh(false);
        setGeneration((value) => value + 1);
      });
    }
    previousScope = current;
  });
  return {
    search,
    setSearch: (value: string) => {
      setCursor(undefined);
      setFresh(false);
      setSearch(value);
    },
    data,
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
        setGeneration((value) => value + 1);
      }),
    retry: () => query.refetch({ cancelRefetch: false }),
  };
}
