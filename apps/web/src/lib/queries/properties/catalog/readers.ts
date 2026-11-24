/**
 * The mounted readers of the property catalog. Writes use them to find which
 * cached lists a new record belongs in, and refreshes reach exactly the lists
 * someone is looking at. A list the server answered within the last five
 * minutes mounts from the cache alone, as main's TanStack `staleTime` did;
 * any other mount reads `cache-and-network`. A refresh marks every list of its
 * kinds stale, mounted or not, as `invalidateQueries` did, so a list nobody
 * shows reloads when it mounts again. Coming back online reloads the lists on
 * screen, as TanStack's reconnect refetch did.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import { normalizedCacheResultMetadata } from '@graphql-cache/index';
import { queryAccountSession } from '@queries/auth/account-scope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type {
  GraphqlPropertyDefinitionScope,
  GraphqlPropertyEntityType,
} from '@service-storage/graphql/generated/graphql';
import { onlineManager } from '@tanstack/solid-query';
import {
  type AnyVariables,
  createRequest,
  type DocumentInput,
  type OperationResult,
  type RequestPolicy,
} from '@urql/core';
import { onCleanup } from 'solid-js';

type ReaderVariant =
  | {
      kind: 'definitions';
      variables: () =>
        | {
            scope: GraphqlPropertyDefinitionScope;
            forEntityType?: GraphqlPropertyEntityType | null;
          }
        | undefined;
      withOptions: boolean;
      /** Definition ids the list holds now. */
      definitionIds: () => readonly string[];
    }
  | {
      kind: 'options';
      propertyDefinitionId: () => string | undefined;
    }
  | {
      kind: 'tags';
      /** The provisioned definition of each scope's set, from the list now. */
      definitions: () => ReadonlyArray<{
        scope: 'USER' | 'TEAM';
        definitionId: string;
      }>;
      /** The sets the list shows now. */
      sets: () => readonly TagSetResponse[];
    };

export type CatalogReader = ReaderVariant & {
  /** urql's key for the read the reader makes now; undefined while paused. */
  key: () => number | undefined;
  refresh: () => Promise<unknown>;
};

type ReaderKind = CatalogReader['kind'];

const READERS = new Set<CatalogReader>();

let reconnectInstalled = false;

// Reloads mounted lists when the app comes back online, as TanStack's
// refetchOnReconnect did, from the same network status (the native network
// path on iOS and Android, browser events elsewhere).
function reloadOnReconnect() {
  if (reconnectInstalled) return;
  reconnectInstalled = true;
  onlineManager.subscribe((online) => {
    if (online) refreshCatalogReadersInBackground();
  });
}

/** Registers a reader for the lifetime of the calling owner. */
export function registerCatalogReader(reader: CatalogReader) {
  reloadOnReconnect();
  READERS.add(reader);
  onCleanup(() => READERS.delete(reader));
}

export function catalogReaders(): CatalogReader[] {
  return [...READERS];
}

/** urql's key for a read, as it keys the operation; undefined while paused. */
export function catalogReadKey<V extends AnyVariables>(
  document: DocumentInput<unknown, V>,
  variables: V | undefined
): number | undefined {
  return variables === undefined
    ? undefined
    : createRequest(document, variables).key;
}

// ---------------------------------------------------------------------------
// Freshness

/** How long a server answer stands without a reload, as main's `staleTime`. */
export const CATALOG_FRESH_MS = 5 * 60 * 1000;

/** When the server last answered each read, by login session and read key. */
const ANSWERED = new Map<string, { kind: ReaderKind; at: number }>();

const answerKey = (key: number) => `${queryAccountSession()}:${key}`;

/**
 * Records a reader's result: a successful server answer makes its read fresh,
 * a refusal makes it stale. Cache answers and failures that reached no server
 * change nothing.
 */
export function noteCatalogResult(
  kind: ReaderKind,
  result: OperationResult<unknown, AnyVariables>
): void {
  const key = answerKey(result.operation.key);
  if (result.error?.graphQLErrors.length) {
    ANSWERED.delete(key);
    return;
  }
  const metadata = normalizedCacheResultMetadata(result);
  const fromServer = !metadata || metadata.source === 'live-network';
  if (fromServer && !result.error && result.data != null)
    ANSWERED.set(key, { kind, at: Date.now() });
}

/**
 * The policy a reader mounts with: the cache alone while the server's last
 * answer to the read is fresh, the cache and then the server otherwise.
 */
export function catalogReadPolicy(key: number | undefined): RequestPolicy {
  if (key === undefined) return 'cache-and-network';
  const answered = ANSWERED.get(answerKey(key));
  return answered && Date.now() - answered.at < CATALOG_FRESH_MS
    ? 'cache-first'
    : 'cache-and-network';
}

/** Marks every read of these kinds stale, mounted or not. */
export function markCatalogStale(
  kinds: readonly ReaderKind[] = ['definitions', 'options', 'tags']
): void {
  for (const [key, answered] of ANSWERED)
    if (kinds.includes(answered.kind)) ANSWERED.delete(key);
}

// ---------------------------------------------------------------------------
// Reloads

/**
 * Reloads mounted readers from the server and marks every other read of
 * their kinds stale. Readers showing the same read share one request: urql
 * sends every `network-only` request, and hands its answer to each reader of
 * that read.
 */
export async function refreshCatalogReaders(
  kinds: readonly ReaderKind[] = ['definitions', 'options', 'tags'],
  filter: (reader: CatalogReader) => boolean = () => true
): Promise<void> {
  markCatalogStale(kinds);
  const sent = new Set<number>();
  const results = await Promise.allSettled(
    catalogReaders()
      .filter((reader) => kinds.includes(reader.kind) && filter(reader))
      .filter((reader) => {
        const key = reader.key();
        if (key === undefined) return true;
        if (sent.has(key)) return false;
        sent.add(key);
        return true;
      })
      .map((reader) => reader.refresh())
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

/** Refresh without waiting; a failure leaves the cached lists on screen. */
export function refreshCatalogReadersInBackground(
  kinds?: readonly ReaderKind[],
  filter?: (reader: CatalogReader) => boolean
) {
  fireAndForget(refreshCatalogReaders(kinds, filter), 'property-catalog');
}
