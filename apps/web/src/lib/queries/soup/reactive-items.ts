/**
 * Reactive urql-backed soup items: the flagged alternative to the TanStack
 * `useSoupAstItemsQuery` path. Each page holds a live subscription to the
 * GraphQL Soup query, so results pushed by the normalized cache exchange
 * (optimistic property mutations, sibling writes, other tabs) re-render
 * the soup list directly — no TanStack invalidation round-trip.
 *
 * Scope matches the GraphQL transport: flat (non-grouped) views whose
 * filter AST has a GraphQL translation. Consumers check `isSupported`
 * and fall back to the TanStack path otherwise.
 */

import { createQuerySignal } from '@graphql-cache/solid/create-query-signal';
import { logger } from '@observability/logger';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import {
  SoupDocument,
  type SoupQuery,
  type SoupQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import type { GraphqlSoupInput } from '@service-storage/graphql-soup';
import {
  getGraphqlSoupClient,
  mapGraphqlSoupPage,
} from '@service-storage/graphql-soup';
import type { CombinedError } from '@urql/core';
import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
  mapArray,
  on,
} from 'solid-js';
import { makeGraphqlSoupInput } from './graphql-ast';
import type { SoupAstBody, SoupAstItemsData, SoupAstParams } from './items';
import { mapSoupPageToEntityList } from './transform-utils';

export type ReactiveSoupAstItemsQueryArgs = {
  params: SoupAstParams;
  body: SoupAstBody;
};

export type ReactiveSoupAstItemsQueryOptions = {
  enabled: boolean;
  showSupportedForeignEntities?: boolean;
};

export type ReactiveSoupAstItemsQuery = {
  data: Accessor<SoupAstItemsData | undefined>;
  /** Latest GraphQL transport or application error. */
  error: Accessor<CombinedError | undefined>;
  /** False when the filter AST has no GraphQL translation. */
  isSupported: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  hasNextPage: Accessor<boolean>;
  fetchNextPage: () => void;
  /** Drops all but the first page (filter changes, pull-to-refresh). */
  trimToFirstPage: () => void;
  /** Trims to the first page and refetches it from the network. */
  refresh: () => Promise<void>;
};

export function useReactiveSoupAstItemsQuery(
  args: Accessor<ReactiveSoupAstItemsQueryArgs>,
  options: Accessor<ReactiveSoupAstItemsQueryOptions>
): ReactiveSoupAstItemsQuery {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  const inputForCursor = (
    cursor: string | null
  ): GraphqlSoupInput | undefined => {
    const { params, body } = args();
    try {
      return makeGraphqlSoupInput({ params, body, cursor });
    } catch {
      // Unsupported GraphQL Soup AST — consumers fall back to TanStack.
      return undefined;
    }
  };

  const firstPageInput = createMemo(() => inputForCursor(null));
  const isSupported = () => firstPageInput() !== undefined;

  // Cursors of the pages currently shown. Structural key: the input memo
  // yields a fresh object per read, so compare serialized form to avoid
  // resetting pagination on every unrelated reactive tick.
  const inputKey = createMemo(() => {
    const input = firstPageInput();
    return input === undefined ? undefined : JSON.stringify(input);
  });
  const [cursors, setCursors] = createSignal<(string | null)[]>([null]);
  createComputed(on(inputKey, () => setCursors([null]), { defer: true }));

  const pages = mapArray(cursors, (cursor) => {
    const query = createQuerySignal<SoupQuery, SoupQueryVariables>({
      client: getGraphqlSoupClient,
      document: SoupDocument,
      // Serve the cached page instantly, revalidate over the network, and
      // keep receiving cache-pushed re-executions for the page's lifetime.
      requestPolicy: 'cache-and-network',
      variables: () => {
        if (!options().enabled) return undefined;
        const input = inputForCursor(cursor);
        return input === undefined ? undefined : { input };
      },
    });
    const page = createMemo(() => {
      const data = query.data();
      return data == null ? undefined : mapGraphqlSoupPage(data);
    });
    return { query, page };
  });

  const error = (): CombinedError | undefined => {
    for (const entry of pages()) {
      const queryError = entry.query.error();
      if (queryError) return queryError;
    }
    return undefined;
  };
  createComputed(
    on(error, (queryError) => {
      if (queryError) {
        logger.error(queryError, { graphqlOperation: 'Soup' });
      }
    })
  );

  const lastPage = () => pages().at(-1);

  const data = createMemo<SoupAstItemsData | undefined>(() => {
    const list = pages();
    if (list[0]?.page() === undefined) return undefined;
    const entities = list.flatMap((entry) => {
      const page = entry.page();
      if (!page) return [];
      return mapSoupPageToEntityList(page, {
        instructionsIdQuery,
        showSupportedForeignEntities: options().showSupportedForeignEntities,
      });
    });
    return { entities, groups: undefined };
  });

  const isFetching = () =>
    pages().some((entry) => entry.query.fetching() || entry.query.stale());

  return {
    data,
    error,
    isSupported,
    isLoading: () => data() === undefined && isFetching(),
    isFetching,
    isFetchingNextPage: () => {
      const last = lastPage();
      return (
        cursors().length > 1 &&
        last !== undefined &&
        last.page() === undefined &&
        last.query.fetching()
      );
    },
    hasNextPage: () => lastPage()?.page()?.next_cursor != null,
    fetchNextPage: () => {
      const next = lastPage()?.page()?.next_cursor;
      if (next == null || cursors().includes(next)) return;
      setCursors((prev) => [...prev, next]);
    },
    trimToFirstPage: () => {
      setCursors((prev) => (prev.length > 1 ? [prev[0] ?? null] : prev));
    },
    refresh: async () => {
      setCursors((prev) => (prev.length > 1 ? [prev[0] ?? null] : prev));
      const input = firstPageInput();
      if (input === undefined) return;
      // Shares the operation key with the page subscription: the fresh
      // network result is broadcast to it, updating the UI.
      const result = await getGraphqlSoupClient()
        .query(SoupDocument, { input }, { requestPolicy: 'network-only' })
        .toPromise();
      if (result.error) throw result.error;
    },
  };
}
