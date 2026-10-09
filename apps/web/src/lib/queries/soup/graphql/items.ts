import type { CombinedError } from '@urql/core';
import { type Accessor, createMemo } from 'solid-js';
import { arrayEquals } from '../../../core/util/compareUtils';
import type { CacheRevision } from '../../../graphql-cache/protocol';
import {
  type GraphqlSoupItem,
  mapGraphqlSoupItem,
} from '../../../service-clients/service-storage/graphql-soup';
import { useInstructionsMdIdQuery } from '../../storage/instructions-md';
import { createKeyedProjection } from '../create-keyed-projection';
import { soupQueryExcludesDone } from '../excludes-done';
import type { SoupAstBody, SoupAstItemsData, SoupAstParams } from '../items';
import { soupEntityTimestamp } from '../page-timestamp';
import {
  mapApiSoupItemToEntity,
  mapSoupPageToEntityList,
} from '../transform-utils';
import { makeGraphqlSoupInput } from './ast';
import {
  createSoupLiveQuery,
  type SoupLiveQueryOptions,
} from './create-soup-live-query';
import { createGraphqlSoupDoneProjection } from './done-projection';
import { usePendingGraphqlSoupDeleteIds } from './optimistic-deletions';
import { usePendingGraphqlSoupDone } from './optimistic-done';
import { soupItemKey } from './reconciliation';

export type GraphqlSoupAstItemsQueryArgs = {
  params: SoupAstParams;
  body: SoupAstBody;
};

export type GraphqlSoupAstItemsQueryOptions = SoupLiveQueryOptions & {
  enabled: boolean;
  showSupportedForeignEntities?: boolean;
};

export type GraphqlSoupAstItemsQuery = {
  localRevision?: Accessor<CacheRevision | undefined>;
  localOptimistic?: Accessor<boolean>;
  data: Accessor<SoupAstItemsData | undefined>;
  /** Latest GraphQL transport or application error. */
  error: Accessor<CombinedError | undefined>;
  /** False when the filter AST has no GraphQL translation. */
  isSupported: Accessor<boolean>;
  isEnabled: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  isPlaceholderData: Accessor<boolean>;
  hasNextPage: Accessor<boolean>;
  fetchNextPage: () => Promise<void>;
  /** Discards loaded continuation pages while retaining the initial page. */
  resetToInitialPage: () => void;
  /** Refetches the currently loaded page chain from the network. */
  refresh: () => Promise<void>;
};

/** Translate the legacy REST-shaped request and project reactive Soup records. */
export function createGraphqlSoupAstItemsQuery(
  args: Accessor<GraphqlSoupAstItemsQueryArgs>,
  options: Accessor<GraphqlSoupAstItemsQueryOptions>
): GraphqlSoupAstItemsQuery {
  const input = createMemo(() => {
    try {
      return makeGraphqlSoupInput({ ...args(), cursor: null }).initial;
    } catch {
      // The public facade still chooses REST for untranslatable filter ASTs.
      return undefined;
    }
  });
  const source = createSoupLiveQuery(input, options);
  const instructions = useInstructionsMdIdQuery();
  const instructionsId = createMemo(() =>
    instructions.isSuccess ? instructions.data : undefined
  );
  const sortMethod = createMemo(() => args().params.sort_method);
  const showForeign = createMemo(() => options().showSupportedForeignEntities);
  const pendingDeleteIds = usePendingGraphqlSoupDeleteIds();
  const pendingDone = usePendingGraphqlSoupDone();
  const projectDone = createGraphqlSoupDoneProjection();
  const excludesDone = createMemo(() => soupQueryExcludesDone([args().body]));

  // One keyed UI projection for network, live, and Mail rows. Retain the
  // fetched version separately: a local edit must not change page coverage.
  type ProjectionRow = {
    key: string;
    record: GraphqlSoupItem;
    fetched?: GraphqlSoupItem;
  };
  const records = createMemo((previous: ProjectionRow[]) => {
    const fetched = new Map(
      source.fetchedRecords().map((record) => [soupItemKey(record), record])
    );
    const visible = new Map(fetched);
    for (const record of source.data() ?? [])
      visible.set(soupItemKey(record), record);
    const old = new Map(previous.map((row) => [row.key, row]));
    return [...visible].map(([key, record]) => {
      const row = old.get(key);
      const baseline = fetched.get(key);
      return row?.record === record && row.fetched === baseline
        ? row
        : { key, record, fetched: baseline };
    });
  }, []);
  const projected = createKeyedProjection(
    records,
    (row) => row.key,
    ({ record, fetched }) => {
      const id = instructionsId();
      const sort = sortMethod();
      const showSupportedForeignEntities = showForeign();
      const item = mapGraphqlSoupItem(record);
      const fetchedItem =
        fetched === record
          ? item
          : fetched
            ? mapGraphqlSoupItem(fetched)
            : undefined;
      return {
        key: soupItemKey(record),
        item: () => item,
        entity: item
          ? mapSoupPageToEntityList(
              { items: [item], next_cursor: undefined },
              {
                instructionsIdQuery: { isSuccess: id !== undefined, data: id },
                showSupportedForeignEntities,
              }
            )[0]
          : undefined,
        timestamp: fetchedItem
          ? soupEntityTimestamp(mapApiSoupItemToEntity(fetchedItem), sort)
          : undefined,
      };
    }
  );
  const byKey = createMemo(
    () => new Map(projected().map((item) => [item.key, item]))
  );
  const visible = createMemo(
    () =>
      (source.data() ?? []).flatMap((record) => {
        const item = byKey().get(soupItemKey(record));
        return item ? [item] : [];
      }),
    undefined,
    { equals: arrayEquals }
  );
  const entities = createMemo(() =>
    visible().flatMap((item) => (item.entity ? [item.entity] : []))
  );
  const itemsById = createMemo(() =>
    source.cachedMail()
      ? Object.fromEntries(
          visible().flatMap((row) => {
            const item = row.item();
            return item ? [[mapApiSoupItemToEntity(item).id, item]] : [];
          })
        )
      : undefined
  );
  const oldestFetchedTimestamp = createMemo(() => {
    let oldest = Infinity;
    for (const record of source.fetchedRecords()) {
      const timestamp = byKey().get(soupItemKey(record))?.timestamp;
      if (timestamp !== undefined) oldest = Math.min(oldest, timestamp);
    }
    return Number.isFinite(oldest) ? oldest : undefined;
  });
  const hasData = createMemo(() => source.data() !== undefined);
  const data = createMemo((): SoupAstItemsData | undefined =>
    hasData()
      ? {
          entities: entities(),
          itemsById: itemsById(),
          cachedMail: source.cachedMail(),
          groups: undefined,
          oldestFetchedTimestamp: oldestFetchedTimestamp(),
        }
      : undefined
  );
  return {
    ...source,
    data: createMemo(() =>
      projectDone(
        source.queryScope(),
        data(),
        pendingDone(),
        excludesDone(),
        pendingDeleteIds()
      )
    ),
  };
}
