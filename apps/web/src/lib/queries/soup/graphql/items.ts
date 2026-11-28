import type { ChannelEntity } from '@entity';
import type { CombinedError } from '@urql/core';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { arrayEquals } from '../../../core/util/compareUtils';
import { readRowSnapshot } from '../../../graphql-cache/exchange/live-query';
import type { QueryRevalidation } from '../../../graphql-cache/exchange/optimistic';
import type { CacheRevision } from '../../../graphql-cache/protocol';
import type { SoupApiItem } from '../../../service-clients/service-storage/generated/schemas';
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
import { finishChannelListRow, isChannelListRow } from './channel-list-row';
import type { GroupedSoupPaging } from './create-grouped-soup-live-query';
import type { PredicateQueryStatus } from './create-predicate-query';
import type { SoupLiveRecord } from './create-soup-live-query';
import {
  createSoupLiveQuery,
  type SoupLiveQueryOptions,
} from './create-soup-live-query';
import { createGraphqlSoupDoneProjection } from './done-projection';
import { usePendingGraphqlSoupDeleteKeys } from './optimistic-deletions';
import { usePendingGraphqlSoupDone } from './optimistic-done';
import { soupItemKey } from './reconciliation';
import { createServerRowShaper } from './server-row-shaper';

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

/** A finished channel-list row, as the projection lists it. */
type ChannelItem = {
  key: string;
  entity: ChannelEntity;
  timestamp: number | undefined;
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
    record: SoupLiveRecord;
    fetched?: GraphqlSoupItem;
    /** `fetched` shaped, on a channel-list view. */
    fetchedRow?: SoupLiveRecord;
  };
  // A channel-list view shows server rows (before the cache serves it, or
  // while the network is authoritative) as the rows the engine shapes.
  const shapeServerRow: (record: SoupLiveRecord) => SoupLiveRecord =
    createServerRowShaper();
  const shapesRows = createMemo(() => options().projection === 'channel-list');
  const records = createMemo((previous: ProjectionRow[]) => {
    const fetched = new Map<string, GraphqlSoupItem>(
      source.fetchedRecords().map((record) => [soupItemKey(record), record])
    );
    const visible = new Map<string, SoupLiveRecord>(fetched);
    for (const record of source.data() ?? [])
      visible.set(soupItemKey(record), record);
    const old = new Map(previous.map((row) => [row.key, row]));
    const shapes = shapesRows();
    return [...visible].map(([key, visibleRecord]) => {
      const record = shapes ? shapeServerRow(visibleRecord) : visibleRecord;
      const row = old.get(key);
      const baseline = fetched.get(key);
      const fetchedRow =
        shapes && baseline ? shapeServerRow(baseline) : undefined;
      return row?.record === record &&
        row.fetched === baseline &&
        row.fetchedRow === fetchedRow
        ? row
        : { key, record, fetched: baseline, fetchedRow };
    });
  }, []);
  // Retain raw SoupApiItems only for Mail views (consumed by `itemsById` when
  // cached Mail is active) so other views neither duplicate mapped rows nor
  // break `createKeyedProjection`'s structural equality check with closures.
  const mailItems = new Map<string, SoupApiItem>();
  const [mailItemsVersion, setMailItemsVersion] = createSignal(0);
  // Shaped channel-list rows skip the keyed projection: they are immutable,
  // so each new row object is finished once, outside any store.
  const keyedRecords = createMemo(
    () => records().filter((row) => !isChannelListRow(row.record)),
    [],
    { equals: arrayEquals }
  );
  const projectedKeyed = createKeyedProjection(
    keyedRecords,
    (row) => row.key,
    ({ record, fetched }) => {
      const sort = sortMethod();
      const showSupportedForeignEntities = showForeign();
      const view = { emailView: input()?.emailView };
      const rawRecord = readRowSnapshot(record as GraphqlSoupItem);
      const rawFetched =
        fetched === record
          ? rawRecord
          : fetched
            ? readRowSnapshot(fetched)
            : undefined;
      const item = mapGraphqlSoupItem(rawRecord, view);
      const fetchedItem =
        rawFetched === rawRecord
          ? item
          : rawFetched
            ? mapGraphqlSoupItem(rawFetched, view)
            : undefined;
      const key = soupItemKey(rawRecord);
      if (view.emailView !== undefined) {
        if (item) {
          if (mailItems.get(key) !== item) {
            mailItems.set(key, item);
            setMailItemsVersion((version) => version + 1);
          }
        } else if (mailItems.delete(key)) {
          setMailItemsVersion((version) => version + 1);
        }
      }
      return {
        key,
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
  const channelItems = new WeakMap<
    ProjectionRow,
    {
      sort: SoupAstParams['sort_method'];
      fetched: SoupLiveRecord | undefined;
      item: ChannelItem;
    }
  >();
  const projectedChannels = createMemo(() => {
    const sort = sortMethod();
    return records().flatMap((row): ChannelItem[] => {
      if (!isChannelListRow(row.record)) return [];
      const entity = finishChannelListRow(row.record);
      // Sort by the fetched version, as the keyed path does: a local edit
      // must not move page coverage.
      const fetched = row.fetchedRow;
      const previous = channelItems.get(row);
      if (
        previous &&
        previous.sort === sort &&
        previous.fetched === fetched &&
        previous.item.entity === entity
      )
        return [previous.item];
      const item = {
        key: row.key,
        entity,
        timestamp:
          fetched && isChannelListRow(fetched)
            ? soupEntityTimestamp(finishChannelListRow(fetched), sort)
            : undefined,
      };
      channelItems.set(row, { sort, fetched, item });
      return [item];
    });
  });
  const projected = createMemo(() => [
    ...projectedKeyed(),
    ...projectedChannels(),
  ]);
  const byKey = createMemo(() => {
    const map = new Map(projected().map((item) => [item.key, item]));
    if (mailItems.size > 0) {
      for (const key of mailItems.keys()) {
        if (!map.has(key)) mailItems.delete(key);
      }
    }
    return map;
  });
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
  const itemsById = createMemo(() => {
    if (!source.cachedMail()) return undefined;
    mailItemsVersion();
    return Object.fromEntries(
      visible().flatMap((row) => {
        const item = mailItems.get(row.key);
        return item ? [[mapApiSoupItemToEntity(item).id, item] as const] : [];
      })
    );
  });
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
