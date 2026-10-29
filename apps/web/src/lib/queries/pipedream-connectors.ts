import {
  openPipedreamConnectUI,
  type PipedreamConnectEvent,
  type PipedreamConnectUI,
} from '@core/pipedream/connect-ui';
import { assignOauthUrl, reserveOauthPopup } from '@core/pipedream/oauth-popup';
import { pipedreamSlugsMatch } from '@core/pipedream/slugs';
import { isTauri } from '@core/util/platform';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { authKeys } from '@queries/auth/keys';
import type { UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { queryReadyGate } from '@queries/gate';
import {
  mcpServersQueryOptions,
  useMcpServersQuery,
} from '@queries/mcp-servers';
import {
  cognitionApiServiceClient,
  PIPEDREAM_DISABLED,
  type PipedreamCatalogResponse,
  type PipedreamConnectionResponse,
  type PipedreamOverlayResponse,
  type PipedreamUpdateRequest,
} from '@service-cognition/client';
import type { ServerResponse } from '@service-cognition/generated/schemas';
import {
  type InfiniteData,
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createMemo } from 'solid-js';

const KEYS = {
  all: ['pipedreamConnectors'] as const,
  list: ['pipedreamConnectors', 'list'] as const,
  overlays: ['pipedreamConnectors', 'overlays'] as const,
  catalog: (search: string) =>
    ['pipedreamConnectors', 'catalog', search] as const,
};

/** Stable placeholder for `neverSuspend` consumers (see below). */
const NO_CONNECTIONS: PipedreamConnectionResponse[] = [];
const NO_OVERLAYS: PipedreamOverlayResponse[] = [];
const NO_SERVERS: ServerResponse[] = [];

function fetchPipedreamConnections() {
  return throwOnErr(
    async () => await cognitionApiServiceClient.listPipedreamConnections()
  );
}

export function pipedreamConnectionsQueryOptions() {
  return { queryKey: KEYS.list, queryFn: fetchPipedreamConnections };
}

export function usePipedreamConnectionsQuery(options?: {
  /**
   * Poll for connection changes. Connecting finishes in the Connect UI
   * iframe, but other tabs never get a focus refetch — surfaces that must
   * flip promptly (the setup connector cards) pass a short interval.
   */
  refetchInterval?: number;
  /** See the same option on `useMcpServersQuery`. */
  neverSuspend?: boolean;
  /** See the same option on `useMcpServersQuery`. */
  enabled?: () => boolean;
}) {
  return useQuery(() => ({
    ...pipedreamConnectionsQueryOptions(),
    enabled: options?.enabled?.() ?? true,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
    refetchInterval: options?.refetchInterval,
    placeholderData: options?.neverSuspend ? NO_CONNECTIONS : undefined,
  }));
}

function fetchPipedreamOverlays() {
  return throwOnErr(
    async () => await cognitionApiServiceClient.listPipedreamOverlays()
  );
}

function pipedreamOverlaysQueryOptions() {
  return {
    queryKey: KEYS.overlays,
    queryFn: fetchPipedreamOverlays,
    staleTime: 10 * 60 * 1000,
  };
}

/**
 * The catalog apps that connect through their own MCP server instead of
 * Pipedream. Never suspends: the empty placeholder only means "not loaded
 * yet", so surfaces that decide anything from it also check `ready`.
 */
export function usePipedreamOverlaysQuery() {
  return useQuery(() => ({
    ...pipedreamOverlaysQueryOptions(),
    placeholderData: NO_OVERLAYS,
  }));
}

function sameEndpoint(a: string, b: string) {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

/** The catalog app a native MCP server stands in for, when it is overlaid. */
export function overlaidAppSlug(
  overlays: readonly PipedreamOverlayResponse[],
  serverUrl: string
): string | undefined {
  return overlays.find((overlay) => sameEndpoint(serverUrl, overlay.server_url))
    ?.app_slug;
}

/**
 * The overlaid apps `servers` holds an enabled, authorized native connection
 * for, by app slug.
 */
export function overlaidSlugsConnected(
  overlays: readonly PipedreamOverlayResponse[],
  servers: readonly ServerResponse[]
): string[] {
  return overlays
    .filter((overlay) =>
      servers.some(
        (server) =>
          server.enabled &&
          server.authenticated &&
          sameEndpoint(server.url, overlay.server_url)
      )
    )
    .map((overlay) => overlay.app_slug);
}

/**
 * The app slugs the current user has connected, as a set, plus whether the
 * answer is known yet. `ready` is false while a query is still serving its
 * `neverSuspend` placeholder, which callers must not read as "connected to
 * nothing". Shared by every surface that shows a connected/not-connected
 * indicator so they cannot disagree. Overlaid apps count as connected
 * through their native MCP server, never through Pipedream.
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
  const overlays = usePipedreamOverlaysQuery();
  const servers = useMcpServersQuery({
    neverSuspend: true,
    refetchInterval: options?.refetchInterval,
  });
  const slugs = createMemo<ReadonlySet<string>>(() => {
    const overlayList = queryReadyGate(overlays) ? overlays.data : NO_OVERLAYS;
    const overlaid = new Set(overlayList.map((overlay) => overlay.app_slug));
    return new Set([
      ...(queryReadyGate(query) ? query.data : NO_CONNECTIONS)
        .filter(
          (connection) =>
            connection.enabled && !overlaid.has(connection.app_slug)
        )
        .map((connection) => connection.app_slug),
      ...overlaidSlugsConnected(
        overlayList,
        queryReadyGate(servers) ? servers.data : NO_SERVERS
      ),
    ]);
  });
  const ready = () =>
    [query, overlays, servers].every(
      (source) => !source.isPlaceholderData && queryReadyGate(source)
    );
  return { slugs, ready };
}

// Serve the previous search's results (or nothing) instead of suspending:
// first load must not block the settings page on the directory, and
// keystrokes must not blank the list while refetching.
function catalogPlaceholder(
  previous:
    | InfiniteData<PipedreamCatalogResponse, string | undefined>
    | undefined
) {
  return previous ?? { pages: [], pageParams: [] };
}

// Cached callbacks only close over the trimmed search string.
function pipedreamCatalogQueryOptions(search: string) {
  return infiniteQueryOptions({
    queryKey: KEYS.catalog(search),
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      throwOnErr(
        async () =>
          await cognitionApiServiceClient.browsePipedreamCatalog({
            search: search || undefined,
            cursor: pageParam,
          })
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PipedreamCatalogResponse) =>
      lastPage.next_cursor ?? undefined,
    staleTime: 5 * 60 * 1000,
    placeholderData: catalogPlaceholder,
  });
}

/**
 * Browse or search the Pipedream app catalog, paged by cursor. Entries come
 * from Pipedream's app directory, ranked most-popular-first.
 */
export function usePipedreamCatalogQuery(search: () => string) {
  return useInfiniteQuery(() => pipedreamCatalogQueryOptions(search().trim()));
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
 * iframe on web or in the system browser on native, and — once the user
 * authorizes — registers the resulting account
 * with our backend, which verifies ownership against Pipedream before
 * storing it.
 *
 * An overlaid app (see {@link usePipedreamOverlaysQuery}) never goes through
 * Pipedream: it authorizes its own MCP server with the native MCP OAuth flow
 * in a new tab instead, and is connected once that server is authorized.
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
  // The authorization URL arrives after an await, so an overlaid app's tab
  // is reserved now, inside the click. Surfaces that offer connecting load
  // the overlays first; an uncached list falls back to opening the URL.
  const cachedOverlay = queryClient
    .getQueryData<PipedreamOverlayResponse[]>(KEYS.overlays)
    ?.find((overlay) => overlay.app_slug === args.appSlug);
  const popup = cachedOverlay ? reserveOauthPopup() : null;
  return Telemetry.span('pipedream.connect', async (span) => {
    span.setAttr('connector.app_slug', args.appSlug);
    span.setAttr('connector.native', isTauri());
    try {
      const overlay =
        cachedOverlay ?? (await lookUpOverlay(args.appSlug, span));
      span.setAttr('connector.overlaid', overlay !== undefined);
      const outcome = overlay
        ? await connectOverlaidApp(overlay, args, popup, span)
        : await connectPipedreamAccount(args, span);
      span.setAttr('connector.outcome', outcome);
      return outcome;
    } catch (error) {
      popup?.close();
      // Do not copy third-party errors or Connect URLs into telemetry.
      span.error('Pipedream connection failed');
      throw error;
    }
  });
}

/**
 * The overlay for `appSlug`, or none when the overlay list cannot be read: a
 * backend without the overlay route still connects through Pipedream, and
 * one with it refuses overlaid apps there itself.
 */
async function lookUpOverlay(
  appSlug: string,
  span: Span
): Promise<PipedreamOverlayResponse | undefined> {
  const overlays = await ResultAsync.fromPromise(
    queryClient.ensureQueryData(pipedreamOverlaysQueryOptions()),
    () => ({ kind: 'overlays-unavailable' as const })
  );
  if (overlays.isErr()) {
    span.setAttr('connector.overlays_unavailable', true);
    return undefined;
  }
  return overlays.value.find((overlay) => overlay.app_slug === appSlug);
}

const OVERLAY_AUTH_POLL_MS = 2000;
// Matches the backend's pending-authorization lifetime.
const OVERLAY_AUTH_TIMEOUT_MS = 10 * 60 * 1000;

function currentUserId() {
  return queryClient.getQueryData<UserInfoData>(authKeys.userInfo.queryKey)?.id;
}

/**
 * Authorize an overlaid app's own MCP server in `popup` (or the system
 * browser), then wait for the server list to show it authorized. The
 * callback page cannot message this tab, so the list is re-read until the
 * grant lands, the tab is closed, or the pending authorization expires.
 */
async function connectOverlaidApp(
  overlay: PipedreamOverlayResponse,
  args: Parameters<typeof connectPipedreamApp>[0],
  popup: Window | null,
  span: Span
): Promise<PipedreamConnectOutcome> {
  const userId = currentUserId();
  const started = await span.span('mcp.auth_start', async () =>
    throwOnErr(
      async () =>
        await cognitionApiServiceClient.startMcpAuth({
          server_url: overlay.server_url,
          server_name: args.serverName ?? overlay.app_slug,
        })
    )
  );
  if (currentUserId() !== userId) {
    popup?.close();
    return 'closed';
  }
  assignOauthUrl(popup, started.authorization_url);

  const consent = span.span('mcp.consent');
  try {
    const deadline = Date.now() + OVERLAY_AUTH_TIMEOUT_MS;
    while (Date.now() < deadline && currentUserId() === userId) {
      const closed = popup?.closed ?? false;
      const servers = await queryClient.fetchQuery({
        ...mcpServersQueryOptions(),
        staleTime: 0,
      });
      if (overlaidSlugsConnected([overlay], servers).length > 0) {
        return 'connected';
      }
      if (closed) return 'closed';
      await new Promise((resolve) => setTimeout(resolve, OVERLAY_AUTH_POLL_MS));
    }
    return 'closed';
  } finally {
    consent.end();
  }
}

async function connectPipedreamAccount(
  args: Parameters<typeof connectPipedreamApp>[0],
  span: Span
): Promise<PipedreamConnectOutcome> {
  if (pipedreamUnsupported) return 'unsupported';

  const userId = currentUserId();
  const token = await span.span('pipedream.token', async () =>
    cognitionApiServiceClient.createPipedreamToken()
  );
  if (token.isErr()) {
    if (token.error.some((e) => e.code === PIPEDREAM_DISABLED)) {
      pipedreamUnsupported = true;
      return 'unsupported';
    }
    throw new ThrownResultError(token.error);
  }

  const openConnectUI = isTauri()
    ? (await import('@core/pipedream/connect-native'))
        .openNativePipedreamConnectUI
    : openPipedreamConnectUI;
  if (currentUserId() !== userId) return 'closed';
  let ui: PipedreamConnectUI | undefined;
  const consented = await span.span(
    'pipedream.consent',
    async () =>
      new Promise<ConsentResult>((resolve) => {
        ui = openConnectUI({
          token: token.value.token,
          app: args.appSlug,
          container: args.container,
          // 'error' events are shown inside the Connect UI itself; the user
          // can retry there or close, so they don't settle the flow.
          onEvent: (event) => {
            if (event.type !== 'error') resolve(event);
          },
        });
      })
  );
  try {
    if (currentUserId() !== userId) return 'closed';
    const connection =
      consented.type === 'success'
        ? await span.span('pipedream.register', async () =>
            throwOnErr(
              async () =>
                await cognitionApiServiceClient.completePipedreamConnection({
                  account_id: consented.accountId,
                  server_name: args.serverName,
                })
            )
          )
        : await recoverUnreportedConnection(args, span);
    if (!connection || currentUserId() !== userId) return 'closed';
    if (
      !pipedreamSlugsMatch(connection.app_slug, args.appSlug) ||
      !connection.enabled
    ) {
      throw new Error('The requested connector was not enabled');
    }
    upsertConnection(connection);
    await invalidateConnections();
    return 'connected';
  } finally {
    ui?.close();
  }
}

type ConsentResult = Exclude<PipedreamConnectEvent, { type: 'error' }>;

/**
 * Pipedream's Connect UI drops its success message when an OAuth provider
 * severs the consent popup's opener, reporting only a close although the
 * account exists. Ask the backend to find and register that account.
 */
async function recoverUnreportedConnection(
  args: Parameters<typeof connectPipedreamApp>[0],
  span: Span
): Promise<PipedreamConnectionResponse | undefined> {
  return span.span('pipedream.recover', async (recover) => {
    const result = await cognitionApiServiceClient.recoverPipedreamConnection({
      app_slug: args.appSlug,
      server_name: args.serverName,
    });
    if (result.isErr()) {
      if (!result.error.some((e) => e.code === 'NOT_FOUND')) {
        throw new ThrownResultError(result.error);
      }
      recover.setAttr('connector.recovered', false);
      return undefined;
    }
    recover.setAttr('connector.recovered', true);
    return result.value;
  });
}
