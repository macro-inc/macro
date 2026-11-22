import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { queryReadyGate } from '@queries/gate';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type {
  Connector,
  ConnectorStatus,
} from '@service-cognition/connector-types';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { connectorKeys } from './keys';

export type {
  CatalogApp,
  Connector,
  ConnectorStatus,
  ConnectStep,
} from '@service-cognition/connector-types';

/** The key of the one app whose connection is the Macro GitHub account link. */
export const GITHUB_CONNECTOR_KEY = 'app/github';

/** The key the server gives a catalog app. Never build a server's key. */
export function appConnectorKey(slug: string): string {
  return `app/${slug}`;
}

/** Stable placeholder while the list has not loaded. */
const NO_CONNECTORS: Connector[] = [];

async function fetchConnectors() {
  return await throwOnErr(
    async () => await cognitionApiServiceClient.listConnectors()
  );
}

export function connectorsQueryOptions() {
  return queryOptions({
    queryKey: connectorKeys.list.queryKey,
    queryFn: fetchConnectors,
  });
}

/**
 * The viewer's apps and servers, each with its status, as the server decided
 * them. Every surface that shows whether something is connected reads it from
 * here, so none of them can disagree with the server or with each other.
 */
export type ConnectorsSource = {
  /** Everything the user holds; empty until `ready`. */
  list: Accessor<readonly Connector[]>;
  /** False until the list has loaded: an empty list then means "unknown". */
  ready: Accessor<boolean>;
  /** The last read failed (a list read before it stays on screen). */
  error: Accessor<boolean>;
  /** Read the list again. */
  retry: () => void;
  /** The connector for a key the server gave, if the user holds it. */
  find: (key: string) => Connector | undefined;
  /** The user's connector for a catalog app, by its canonical slug. */
  app: (slug: string) => Connector | undefined;
  /** Where the user stands with an app; `notConnected` when not held. */
  appStatus: (slug: string) => ConnectorStatus;
  /** Slugs of the apps that are connected now. */
  connectedApps: Accessor<ReadonlySet<string>>;
};

/**
 * The viewer's connectors. Never suspends: check `ready` before reading an
 * empty list as "nothing connected". Refetches on mount and window focus,
 * because consent often finishes in another window.
 */
export function useConnectors(options?: {
  /** Poll while a surface waits for a connection to change. */
  refetchInterval?: number;
  /** Defer fetching until the surface needs the list. */
  enabled?: () => boolean;
}): ConnectorsSource {
  const query = useQuery(() => ({
    ...connectorsQueryOptions(),
    enabled: options?.enabled?.() ?? true,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
    refetchInterval: options?.refetchInterval,
    placeholderData: NO_CONNECTORS,
    reconcile: 'key',
  }));
  const ready = () => !query.isPlaceholderData && queryReadyGate(query);
  const list = (): readonly Connector[] =>
    !query.isPlaceholderData && queryReadyGate(query) ? query.data : [];
  const app = (slug: string) =>
    list().find(
      (connector) =>
        connector.target.type === 'app' && connector.target.slug === slug
    );
  const connectedApps = createMemo<ReadonlySet<string>>(
    () =>
      new Set(
        list().flatMap((connector) =>
          connector.target.type === 'app' && connector.status === 'connected'
            ? [connector.target.slug]
            : []
        )
      )
  );
  return {
    list,
    ready,
    error: () => query.isError,
    retry: () => fireAndForget(query.refetch(), 'connectors'),
    find: (key) => list().find((connector) => connector.key === key),
    app,
    appStatus: (slug) => app(slug)?.status ?? 'notConnected',
    connectedApps,
  };
}

/** Put a connector the server just answered with into every reader's list. */
export function upsertConnector(connector: Connector) {
  queryClient.setQueryData(
    connectorKeys.list.queryKey,
    (current: Connector[] | undefined) => {
      if (!current) return [connector];
      const index = current.findIndex((row) => row.key === connector.key);
      if (index === -1) return [...current, connector];
      const next = [...current];
      next[index] = connector;
      return next;
    }
  );
}

/**
 * A copy of the cached list to roll back to. Readers reconcile by key, which
 * writes into the cached rows, so the cached list itself would change too.
 */
function snapshotConnectors(): Connector[] | undefined {
  const current = queryClient.getQueryData<Connector[]>(
    connectorKeys.list.queryKey
  );
  return current && structuredClone(unwrap(current));
}

/** Change a held connector in every reader's list; returns the previous list. */
export function patchConnector(
  key: string,
  patch: (connector: Connector) => Connector
): Connector[] | undefined {
  const previous = snapshotConnectors();
  queryClient.setQueryData(
    connectorKeys.list.queryKey,
    (current: Connector[] | undefined) =>
      current?.map((row) => (row.key === key ? patch(row) : row))
  );
  return previous;
}

/** Drop a connector from every reader's list; returns the previous list. */
export function dropConnector(key: string): Connector[] | undefined {
  const previous = snapshotConnectors();
  queryClient.setQueryData(
    connectorKeys.list.queryKey,
    (current: Connector[] | undefined) =>
      current?.filter((row) => row.key !== key)
  );
  return previous;
}

/** Put back the list a failed optimistic change replaced. */
export function restoreConnectors(previous: Connector[] | undefined) {
  queryClient.setQueryData(connectorKeys.list.queryKey, previous);
}

/** Read the list again for every reader. */
export function invalidateConnectors() {
  return queryClient.invalidateQueries({
    queryKey: connectorKeys.list.queryKey,
  });
}

/** The viewer's connectors, read fresh, for a decision made on a click. */
export async function readConnectors(): Promise<Connector[]> {
  return await queryClient.fetchQuery({
    ...connectorsQueryOptions(),
    staleTime: 0,
  });
}
