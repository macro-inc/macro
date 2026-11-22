import type { CombinedError } from '@urql/core';
import { type Accessor, createMemo } from 'solid-js';
import { arrayEquals } from '../../../core/util/compareUtils';
import type { QueryRevalidation } from '../../../graphql-cache/exchange/optimistic';
import type { CacheRevision } from '../../../graphql-cache/protocol';
import {
  type GraphqlSoupItem,
  mapGraphqlSoupItem,
} from '../../../service-clients/service-storage/graphql-soup';
import { createKeyedProjection } from '../create-keyed-projection';
import { soupQueryExcludesDone } from '../excludes-done';
import type { SoupAstBody, SoupAstItemsData, SoupAstParams } from '../items';
import { soupEntityTimestamp } from '../page-timestamp';
import {
  mapApiSoupItemToEntity,
  mapSoupPageToEntityList,
} from '../transform-utils';
import { makeGraphqlSoupInput } from './ast';
import type { GroupedSoupPaging } from './create-grouped-soup-live-query';
import type { PredicateQueryStatus } from './create-predicate-query';
import {
  createSoupLiveQuery,
  type SoupLiveQueryOptions,
} from './create-soup-live-query';
import { createGraphqlSoupDoneProjection } from './done-projection';
import { usePendingGraphqlSoupDeleteKeys } from './optimistic-deletions';
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
  groupedPaging?: GroupedSoupPaging;
  /** Cache writes keep this list current. Grouped lists leave it out. */
  cacheMaintained?: Accessor<boolean>;
  /** Readiness of the local predicate, not proof of complete server membership. */
  cacheStatus?: Accessor<PredicateQueryStatus>;
  localRevision?: Accessor<CacheRevision | undefined>;
  localOptimistic?: Accessor<boolean>;
  revalidationQueries?: Accessor<readonly QueryRevalidation[]>;
  data: Accessor<SoupAstItemsData | undefined>;
  /** Latest GraphQL transport or application error. */
  error: Accessor<CombinedError | undefined>;
  /** Includes background failures hidden by the cached-data display policy. */
  fetchError?: Accessor<CombinedError | undefined>;
  /** False when the filter AST has no GraphQL translation. */
  isSupported: Accessor<boolean>;
  isEnabled: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  /** Excludes partial local predicate snapshots with no cached or fetched page. */
  hasPageData: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  /** The current error came from loading a continuation page. */
  isFetchNextPageError: Accessor<boolean>;
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
  const sortMethod = createMemo(() => args().params.sort_method);
  const showForeign = createMemo(() => options().showSupportedForeignEntities);
  const pendingDeleteKeys = usePendingGraphqlSoupDeleteKeys();
  const pendingDone = usePendingGraphqlSoupDone();
  const projectDone = createGraphqlSoupDoneProjection();
  const excludesDone = createMemo(() => soupQueryExcludesDone([args().body]));

  // One keyed UI projection for network, live, and Mail rows. Retain the
  // fetched version separately: a local edit must not change page coverage.
  type ProjectionRow = {
    key: string;
    record: GraphqlSoupItem;
    fetched?: GraphqlSoupItem;
    /** The page's notification time for this item, on NOTIFIED_AT pages. */
    notifiedAt?: string;
    /** An email thread's updatedAt as its NOTIFIED_AT page gave it. */
    updatedAt?: string;
  };
  const records = createMemo((previous: ProjectionRow[]) => {
    const fetched = new Map(
      source.fetchedRecords().map((record) => [soupItemKey(record), record])
    );
    const stamps = source.fetchedNotifiedAt();
    const emailTimes = source.fetchedEmailUpdatedAt();
    const visible = new Map(fetched);
    for (const record of source.data() ?? [])
      visible.set(soupItemKey(record), record);
    const old = new Map(previous.map((row) => [row.key, row]));
    return [...visible].map(([key, record]) => {
      const row = old.get(key);
      const baseline = fetched.get(key);
      const notifiedAt = stamps.get(key);
      const updatedAt = emailTimes.get(key);
      return row?.record === record &&
        row.fetched === baseline &&
        row.notifiedAt === notifiedAt &&
        row.updatedAt === updatedAt
        ? row
        : { key, record, fetched: baseline, notifiedAt, updatedAt };
    });
  }, []);
  const projected = createKeyedProjection(
    records,
    (row) => row.key,
    ({ record, fetched, notifiedAt, updatedAt }) => {
      const sort = sortMethod();
      const showSupportedForeignEntities = showForeign();
      const view = { emailView: input()?.emailView };
      // REST items carry `notified_at` themselves; GraphQL lists it on the
      // page, since it orders this list rather than describing the record.
      // A notified list also keeps the updatedAt its own page gave an email
      // thread: the thread's one cached record holds whichever view wrote it
      // last (the Mail backfill reads All Mail), and a done mail row is
      // labelled by it.
      const mapItem = (value: GraphqlSoupItem) => {
        const mapped = mapGraphqlSoupItem(value, view);
        if (!mapped || !notifiedAt) return mapped;
        if (updatedAt && mapped.tag === 'emailThread')
          return {
            ...mapped,
            notified_at: notifiedAt,
            data: { ...mapped.data, updatedAt },
          };
        return { ...mapped, notified_at: notifiedAt };
      };
      const item = mapItem(record);
      const fetchedItem =
        fetched === record ? item : fetched ? mapItem(fetched) : undefined;
      return {
        key: soupItemKey(record),
        item: () => item,
        entity: item
          ? mapSoupPageToEntityList(
              { items: [item], next_cursor: undefined },
              { showSupportedForeignEntities }
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
        pendingDeleteKeys()
      )
    ),
  };
}
