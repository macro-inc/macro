import { deepEqual } from '@core/util/compareUtils';
import { Telemetry } from '@macro-inc/observability';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { type Accessor, createMemo, mapArray } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  GroupedSoupInitialInput,
  GroupSoupQuery,
  SoupItemFieldsFragment,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import { reconcileGroupedSoup } from '../grouped/reconciliation';
import type { LiveQuerySnapshot } from './create-predicate-query';
import { soupItemKey } from './reconciliation';

export type GroupedSoupBin =
  GroupSoupQuery['user']['groupSoup']['bins'][number];

/** Only complete selected grouping evidence can replace server membership. */
export function localSoupGroupKeys(
  item: SoupItemFieldsFragment,
  input: GroupedSoupInitialInput,
  now: Date
): string[] | undefined {
  return (
    match(input.groupBy.field)
      // Entity type cannot change for a normalized identity. Retain its server key.
      .with('ENTITY_TYPE', () => undefined)
      .with('PROJECT', () =>
        localSoupGroupKeys(
          item,
          {
            ...input,
            groupBy: {
              field: 'PROPERTY',
              propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
            },
          },
          now
        )
      )
      .with('PROPERTY', () => {
        if (!('properties' in item)) return undefined;
        const entityType = match(item)
          .with({ __typename: 'GraphqlSoupDocument' }, (item) =>
            item.subType?.__typename === 'GraphqlTaskSubType'
              ? 'TASK'
              : 'DOCUMENT'
          )
          .with({ __typename: 'GraphqlSoupEmailThread' }, () => 'THREAD')
          .with({ __typename: 'GraphqlSoupCrmCompany' }, () => 'COMPANY')
          .with({ __typename: 'GraphqlSoupCall' }, () => 'CALL_RECORD')
          .otherwise((item) => item.entityType);
        if (input.groupBy.entityType && input.groupBy.entityType !== entityType)
          return [''];
        const property = item.properties.find(
          (property) =>
            property.propertyDefinitionId === input.groupBy.propertyDefinitionId
        );
        const value = property?.value;
        if (!value) return [''];
        const keys = match(value)
          .with(
            { __typename: 'GraphqlSelectOptionPropertyValue' },
            (value) => value.optionIds
          )
          .with(
            { __typename: 'GraphqlEntityReferencePropertyValue' },
            (value) => value.references.map((reference) => reference.entityId)
          )
          .with(
            { __typename: 'GraphqlLinkPropertyValue' },
            (value) => value.urls
          )
          // The server's lateral join puts scalar property values in Not Set.
          .otherwise(() => []);
        return keys.length ? [...new Set(keys)] : [''];
      })
      .with('DATE', () => {
        if (
          input.sortMethod !== 'CREATED_AT' &&
          input.sortMethod !== 'UPDATED_AT'
        )
          return undefined;
        const value =
          input.sortMethod === 'CREATED_AT'
            ? 'createdAt' in item
              ? item.createdAt
              : undefined
            : 'updatedAt' in item
              ? item.updatedAt
              : undefined;
        if (!value) return undefined;
        const timestamp = new Date(value);
        if (!Number.isFinite(timestamp.getTime())) return undefined;
        const day = (date: Date) =>
          Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate()
          );
        const age = (day(now) - day(timestamp)) / 86_400_000;
        // Matches the grouped SQL CASE, including future timestamps (this_week).
        return [
          age === 0
            ? 'today'
            : age === 1
              ? 'yesterday'
              : age <= 6
                ? 'this_week'
                : age <= 13
                  ? 'last_week'
                  : age <= 30
                    ? 'this_month'
                    : age <= 60
                      ? 'last_month'
                      : 'older',
        ];
      })
      // An unknown grouping field (a newer server) keeps the server key.
      .exhaustive(() => undefined)
  );
}

/** Merge page evidence once per normalized identity; initial metadata wins. */
export function mergeGroupedSoupBins(
  pages: readonly GroupSoupQuery[]
): GroupedSoupBin[] {
  const bins = new Map<
    string,
    { metadata: GroupedSoupBin; items: Map<string, SoupItemFieldsFragment> }
  >();
  for (const page of pages) {
    for (const bin of page.user.groupSoup.bins) {
      let merged = bins.get(bin.key);
      if (!merged) {
        merged = { metadata: bin, items: new Map() };
        bins.set(bin.key, merged);
      }
      for (const item of bin.items) {
        const key = soupItemKey(item);
        if (!merged.items.has(key)) merged.items.set(key, item);
      }
    }
  }
  return [...bins.values()].map(({ metadata, items }) => ({
    ...metadata,
    items: [...items.values()],
  }));
}

/** Index immutable server evidence once, not on each live field update. */
function indexGroupedSoup(
  baseline: readonly GroupedSoupBin[],
  input: GroupedSoupInitialInput,
  now: Date,
  untrustedKeys: ReadonlySet<string>
) {
  const original = new Map<string, SoupItemFieldsFragment>();
  const oldKeys = new Map<string, string[]>();
  const bins = baseline.map((bin) => ({
    ...bin,
    itemIds: bin.items.map((item) => {
      const key = soupItemKey(item);
      original.set(key, item);
      const keys = oldKeys.get(key);
      if (keys) keys.push(bin.key);
      else oldKeys.set(key, [bin.key]);
      return key;
    }),
  }));
  const previousKeys = new Map(
    [...original].map(([key, item]) => [
      key,
      input.groupBy.field === 'PROPERTY'
        ? untrustedKeys.has(key)
          ? undefined
          : localSoupGroupKeys(item, input, now)
        : oldKeys.get(key),
    ])
  );
  return {
    original,
    previousKeys,
    bins,
    rowCount: baseline.reduce((count, bin) => count + bin.items.length, 0),
  };
}

function projectIndexedGroupedSoup(
  baseline: ReturnType<typeof indexGroupedSoup>,
  currentItems: ReadonlyMap<string, SoupItemFieldsFragment>,
  keys: readonly string[],
  selected: ReadonlyMap<string, SoupItemFieldsFragment>,
  groupKeys: ReadonlyMap<string, string[] | undefined>
): GroupedSoupBin[] {
  const surviving = new Set(keys);
  const evidence = keys.flatMap((key) => {
    if (!baseline.original.has(key)) return [];
    return [
      {
        id: key,
        previousGroupKeys: baseline.previousKeys.get(key),
        groupKeys: groupKeys.get(key),
      },
    ];
  });
  for (const key of baseline.original.keys()) {
    if (!surviving.has(key))
      evidence.push({
        id: key,
        previousGroupKeys: baseline.previousKeys.get(key),
        groupKeys: [],
      });
  }
  return reconcileGroupedSoup(baseline.bins, evidence).map((bin) => ({
    key: bin.key,
    totalCount: bin.totalCount,
    nextCursor: bin.nextCursor,
    items: bin.itemIds.flatMap((key) => {
      const item =
        selected.get(key) ??
        currentItems.get(key) ??
        baseline.original.get(key);
      return item ? [item] : [];
    }),
  }));
}

/** Apply the maintained filter result without treating bounded candidates as complete bins. */
export function projectLocalGroupedSoup(
  baseline: readonly GroupedSoupBin[],
  currentItems: ReadonlyMap<string, SoupItemFieldsFragment>,
  snapshot: LiveQuerySnapshot<SoupItemFieldsFragment>,
  input: GroupedSoupInitialInput,
  now: Date,
  untrustedKeys: ReadonlySet<string> = new Set()
): GroupedSoupBin[] {
  return projectIndexedGroupedSoup(
    indexGroupedSoup(baseline, input, now, untrustedKeys),
    currentItems,
    snapshot.keys,
    new Map(snapshot.records.map((row) => [row.recordKey, row.record])),
    new Map(
      snapshot.records.map((row) => [
        row.recordKey,
        localSoupGroupKeys(row.record, input, now),
      ])
    )
  );
}

/** Track grouping fields per live row; unrelated field patches keep the bins intact. */
export function createLocalGroupedSoupProjection(options: {
  baseline: Accessor<
    | { bins: readonly GroupedSoupBin[]; untrustedKeys: ReadonlySet<string> }
    | undefined
  >;
  currentItems: Accessor<ReadonlyMap<string, SoupItemFieldsFragment>>;
  snapshot: Accessor<LiveQuerySnapshot<SoupItemFieldsFragment> | undefined>;
  input: Accessor<GroupedSoupInitialInput | undefined>;
  now: Accessor<Date>;
}): Accessor<GroupedSoupBin[] | undefined> {
  const input = createMemo(options.input);
  const keys = createMemo(() => options.snapshot()?.keys);
  const records = createMemo(() => options.snapshot()?.records ?? []);
  const index = createMemo(() => {
    const baseline = options.baseline();
    const initial = input();
    return baseline && initial
      ? indexGroupedSoup(
          baseline.bins,
          initial,
          options.now(),
          baseline.untrustedKeys
        )
      : undefined;
  });
  const rows = mapArray(records, (row) => ({
    row,
    groupKeys: createMemo(
      () => {
        const initial = input();
        return initial
          ? localSoupGroupKeys(row.record, initial, options.now())
          : undefined;
      },
      undefined,
      { equals: deepEqual }
    ),
  }));
  const selected = createMemo(
    () => new Map(rows().map(({ row }) => [row.recordKey, row.record]))
  );
  const groupKeys = createMemo(
    () =>
      new Map(rows().map(({ row, groupKeys }) => [row.recordKey, groupKeys()]))
  );
  return createMemo(() => {
    const baseline = index();
    const order = keys();
    const initial = input();
    if (!baseline || !order || !initial) return undefined;
    const span = Telemetry.span('graphql_cache.soup_grouped_local_evaluation');
    try {
      const result = projectIndexedGroupedSoup(
        baseline,
        options.currentItems(),
        order,
        selected(),
        groupKeys()
      );
      span.setAttr('grouping.field', initial.groupBy.field);
      span.setAttr('grouping.bin_count', result.length);
      span.setAttr('grouping.baseline_count', baseline.rowCount);
      return result;
    } finally {
      span.end();
    }
  });
}
