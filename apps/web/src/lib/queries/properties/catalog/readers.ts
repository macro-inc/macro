/**
 * The mounted readers of the property catalog. Writes use them to find which
 * cached lists a new record belongs in, and refreshes reach exactly the lists
 * someone is looking at; a list nobody shows refreshes when it mounts again,
 * since every reader loads `cache-and-network`.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import type {
  GraphqlPropertyDefinitionScope,
  GraphqlPropertyEntityType,
} from '@service-storage/graphql/generated/graphql';
import { onCleanup } from 'solid-js';

export type CatalogReader =
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
      refresh: () => Promise<unknown>;
    }
  | {
      kind: 'options';
      propertyDefinitionId: () => string | undefined;
      refresh: () => Promise<unknown>;
    }
  | {
      kind: 'tags';
      /** The provisioned definition of each scope's set, from the list now. */
      definitions: () => ReadonlyArray<{
        scope: 'USER' | 'TEAM';
        definitionId: string;
      }>;
      refresh: () => Promise<unknown>;
    };

const READERS = new Set<CatalogReader>();

/** Registers a reader for the lifetime of the calling owner. */
export function registerCatalogReader(reader: CatalogReader) {
  READERS.add(reader);
  onCleanup(() => READERS.delete(reader));
}

export function catalogReaders(): CatalogReader[] {
  return [...READERS];
}

type ReaderKind = CatalogReader['kind'];

/**
 * Reloads mounted readers from the server. Readers that show the same list
 * share one request, since urql deduplicates identical operations.
 */
export async function refreshCatalogReaders(
  kinds: readonly ReaderKind[] = ['definitions', 'options', 'tags'],
  filter: (reader: CatalogReader) => boolean = () => true
): Promise<void> {
  const results = await Promise.allSettled(
    catalogReaders()
      .filter((reader) => kinds.includes(reader.kind) && filter(reader))
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
