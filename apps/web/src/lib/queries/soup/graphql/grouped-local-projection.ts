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
      .with('DEADLINE', () => undefined)
      .with('PROJECT', () => {
        if ('projectId' in item) return [item.projectId ?? ''];
        if (item.__typename === 'GraphqlSoupProject')
          return [item.parentId ?? ''];
        return undefined;
      })
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

/** Apply the maintained filter result without treating bounded candidates as complete bins. */
export function projectLocalGroupedSoup(
  baseline: readonly GroupedSoupBin[],
  currentItems: ReadonlyMap<string, SoupItemFieldsFragment>,
  snapshot: LiveQuerySnapshot<SoupItemFieldsFragment>,
  input: GroupedSoupInitialInput,
  now: Date,
  untrustedKeys: ReadonlySet<string> = new Set()
): GroupedSoupBin[] {
  const original = new Map(
    baseline.flatMap((bin) =>
      bin.items.map((item) => [soupItemKey(item), item] as const)
    )
  );
  const oldKeys = new Map<string, string[]>();
  for (const bin of baseline)
    for (const item of bin.items) {
      const key = soupItemKey(item);
      oldKeys.set(key, [...(oldKeys.get(key) ?? []), bin.key]);
    }
  const previousKeys = (key: string, item: SoupItemFieldsFragment) =>
    input.groupBy.field === 'PROPERTY'
      ? untrustedKeys.has(key)
        ? undefined
        : localSoupGroupKeys(item, input, now)
      : oldKeys.get(key);
  const selected = new Map(
    snapshot.records.map((row) => [row.recordKey, row.record])
  );
  const surviving = new Set(snapshot.keys);
  const evidence = snapshot.keys.flatMap((key) => {
    const previous = original.get(key);
    if (!previous) return [];
    const current = selected.get(key);
    return [
      {
        id: key,
        previousGroupKeys: previousKeys(key, previous),
        groupKeys: current
          ? localSoupGroupKeys(current, input, now)
          : undefined,
      },
    ];
  });
  for (const [key, item] of original) {
    if (!surviving.has(key))
      evidence.push({
        id: key,
        previousGroupKeys: previousKeys(key, item),
        groupKeys: [],
      });
  }
  const bins = reconcileGroupedSoup(
    baseline.map((bin) => ({ ...bin, itemIds: bin.items.map(soupItemKey) })),
    evidence
  );
  return bins.map((bin) => ({
    key: bin.key,
    totalCount: bin.totalCount,
    nextCursor: bin.nextCursor,
    items: bin.itemIds.flatMap((key) => {
      const item =
        selected.get(key) ?? currentItems.get(key) ?? original.get(key);
      return item ? [item] : [];
    }),
  }));
}
