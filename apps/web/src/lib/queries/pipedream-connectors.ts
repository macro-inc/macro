import { openPipedreamConnectUI } from '@core/pipedream/connect-ui';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  cognitionApiServiceClient,
  PIPEDREAM_DISABLED,
  type PipedreamCatalogResponse,
  type PipedreamConnectionResponse,
  type PipedreamUpdateRequest,
} from '@service-cognition/client';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';

const KEYS = {
  all: ['pipedreamConnectors'] as const,
  list: ['pipedreamConnectors', 'list'] as const,
  catalog: (search: string) =>
    ['pipedreamConnectors', 'catalog', search] as const,
};

/** Stable placeholder for `neverSuspend` consumers (see below). */
const NO_CONNECTIONS: PipedreamConnectionResponse[] = [];

export function usePipedreamConnectionsQuery(options?: {
  /**
   * Poll for connection changes. Connecting finishes in the Connect UI
   * iframe, but other tabs never get a focus refetch — surfaces that must
   * flip promptly (the setup connector cards) pass a short interval.
   */
  refetchInterval?: number;
  /** See the same option on `useMcpServersQuery`. */
  neverSuspend?: boolean;
}) {
  return useQuery(() => ({
    queryKey: KEYS.list,
    queryFn: async () =>
      throwOnErr(
        async () => await cognitionApiServiceClient.listPipedreamConnections()
      ),
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
    refetchInterval: options?.refetchInterval,
    placeholderData: options?.neverSuspend ? NO_CONNECTIONS : undefined,
  }));
}

/**
 * The app slugs the current user has connected, as a set, plus whether the
 * answer is known yet. `ready` is false while the query is still serving the
 * `neverSuspend` placeholder, which callers must not read as "connected to
 * nothing". Shared by every surface that shows a connected/not-connected
 * indicator so they cannot disagree.
 */
export function usePipedreamConnectedSlugs(options?: {
  refetchInterval?: number;
}): {
  slugs: Accessor<ReadonlySet<string>>;
  ready: Accessor<boolean>;
} {
  const query = usePipedreamConnectionsQuery({
    neverSuspend: true,
    refetchInterval: options?.refetchInterval,
  });
  const slugs = createMemo<ReadonlySet<string>>(
    () =>
      new Set(
        (query.isSuccess ? query.data : NO_CONNECTIONS).map(
          (connection) => connection.app_slug
        )
      )
  );
  const ready = () => !query.isPlaceholderData && !query.isPending;
  return { slugs, ready };
}

/**
 * Browse or search the Pipedream app catalog, paged by cursor. Entries come
 * from Pipedream's app directory, ranked most-popular-first.
 */
export function usePipedreamCatalogQuery(search: () => string) {
  return useInfiniteQuery(() => ({
    queryKey: KEYS.catalog(search().trim()),
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      throwOnErr(
        async () =>
          await cognitionApiServiceClient.browsePipedreamCatalog({
            search: search().trim() || undefined,
            cursor: pageParam,
          })
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PipedreamCatalogResponse) =>
      lastPage.next_cursor ?? undefined,
    staleTime: 5 * 60 * 1000,
    // Serve the previous search's results (or nothing) instead of
    // suspending: first load must not block the settings page on the
    // directory, and keystrokes must not blank the list while refetching.
    placeholderData: (
      previous:
        | InfiniteData<PipedreamCatalogResponse, string | undefined>
        | undefined
    ) => previous ?? { pages: [], pageParams: [] },
  }));
}

function invalidateConnections() {
  return queryClient.invalidateQueries({ queryKey: KEYS.list });
}

function upsertConnection(connection: PipedreamConnectionResponse) {
  queryClient.setQueryData(
    KEYS.list,
    (current: PipedreamConnectionResponse[] | undefined) => {
      if (!current) return [connection];
      const index = current.findIndex(
        (c) => c.app_slug === connection.app_slug
      );
      if (index === -1) return [...current, connection];
      const next = [...current];
      next[index] = connection;
      return next;
    }
  );
}

function removeConnection(appSlug: string) {
  queryClient.setQueryData(
    KEYS.list,
    (current: PipedreamConnectionResponse[] | undefined) =>
      current?.filter((c) => c.app_slug !== appSlug) ?? current
  );
}

export function useUpdatePipedreamConnectionMutation() {
  return useMutation(() => ({
    mutationFn: async (request: PipedreamUpdateRequest) =>
      throwOnErr(
        async () =>
          await cognitionApiServiceClient.updatePipedreamConnection(request)
      ),
    onSuccess: async (connection: PipedreamConnectionResponse) => {
      upsertConnection(connection);
      await invalidateConnections();
    },
  }));
}

export function useDeletePipedreamConnectionMutation() {
  return useMutation(() => ({
    mutationFn: async (args: { app_slug: string }) =>
      throwOnErr(
        async () =>
          await cognitionApiServiceClient.deletePipedreamConnection(args)
      ),
    onSuccess: async (_result: unknown, variables: { app_slug: string }) => {
      removeConnection(variables.app_slug);
      await invalidateConnections();
    },
  }));
}

export type PipedreamConnectOutcome = 'connected' | 'closed' | 'unsupported';

// Whether the backend has Pipedream configured, learned from the first token
// attempt (501 → unsupported). Cached so later connect clicks on an
// unconfigured deployment fail fast instead of re-probing.
let pipedreamUnsupported = false;

/**
 * Connect an MCP app through Pipedream's hosted Connect UI.
 *
 * Mints a Connect token (Pipedream owns the consent flow, credential
 * storage, and refresh), opens the hosted Connect UI in a fullscreen
 * iframe, and — once the user authorizes — registers the resulting account
 * with our backend, which verifies ownership against Pipedream before
 * storing it.
 *
 * Resolves `'connected'` on success (connections cache already refreshed),
 * `'closed'` when the user dismissed the UI without finishing, and
 * `'unsupported'` when the deployment has no Pipedream configured. Rejects
 * on errors.
 */
export async function connectPipedreamApp(args: {
  /** The Pipedream app to connect, by name slug (e.g. `linear`). */
  appSlug: string;
  /** Display name stored on the connection row. */
  serverName?: string;
  /** Where the Connect iframe mounts; see `openPipedreamConnectUI`. */
  container?: HTMLElement;
}): Promise<PipedreamConnectOutcome> {
  if (pipedreamUnsupported) return 'unsupported';

  const token = await cognitionApiServiceClient.createPipedreamToken();
  if (token.isErr()) {
    if (token.error.some((e) => e.code === PIPEDREAM_DISABLED)) {
      pipedreamUnsupported = true;
      return 'unsupported';
    }
    throw new ThrownResultError(token.error);
  }

  return await new Promise<PipedreamConnectOutcome>((resolve, reject) => {
    let settled = false;
    const ui = openPipedreamConnectUI({
      token: token.value.token,
      app: args.appSlug,
      container: args.container,
      onEvent: (event) => {
        if (event.type === 'success' && !settled) {
          settled = true;
          void (async () => {
            try {
              const connection = await throwOnErr(
                async () =>
                  await cognitionApiServiceClient.completePipedreamConnection({
                    account_id: event.accountId,
                    server_name: args.serverName,
                  })
              );
              upsertConnection(connection);
              await invalidateConnections();
              resolve('connected');
            } catch (error) {
              reject(
                error instanceof Error
                  ? error
                  : new Error('failed to register Pipedream connection')
              );
            } finally {
              ui.close();
            }
          })();
        } else if (event.type === 'close' && !settled) {
          settled = true;
          resolve('closed');
        }
        // 'error' events are shown inside the Connect UI itself; the user
        // can retry there or close, so they don't settle the promise.
      },
    });
  });
}
