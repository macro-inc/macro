import { type Accessor, createMemo } from 'solid-js';
import { arrayEquals } from '../../../core/util/compareUtils';
import type { GroupSoupQuery } from '../../../service-clients/service-storage/graphql/generated/graphql';
import {
  type GraphqlSoupItem,
  mapGraphqlSoupItem,
} from '../../../service-clients/service-storage/graphql-soup';
import { createKeyedProjection } from '../../../urql-solid/create-keyed-projection';
import { makeGroupComparator, resolveGroupMetaForKey } from '../grouped/api';
import type { GroupByField, GroupMeta } from '../grouped/types';
import type { SoupAstItemsData } from '../items';
import { mapSoupPageToEntityList } from '../transform-utils';
import { soupItemKey } from './reconciliation';

/** Project each loaded row once; nested edits retain the other rows and bins. */
export function createGraphqlGroupedSoupProjection(
  source: Accessor<GroupSoupQuery | undefined>,
  groupBy: Accessor<GroupByField | undefined>,
  options: Accessor<Parameters<typeof mapSoupPageToEntityList>[1]>
): Accessor<SoupAstItemsData | undefined> {
  const bins = createMemo(() => source()?.user.groupSoup.bins ?? []);
  const records = createMemo(
    () => {
      const unique = new Map<string, GraphqlSoupItem>();
      for (const bin of bins())
        for (const item of bin.items) unique.set(soupItemKey(item), item);
      return [...unique.values()];
    },
    undefined,
    { equals: arrayEquals }
  );
  const rows = createKeyedProjection(records, soupItemKey, (record) => {
    const item = mapGraphqlSoupItem(record);
    return {
      id: record.id,
      item,
      entity: item
        ? mapSoupPageToEntityList(
            { items: [item], next_cursor: undefined },
            options()
          )[0]
        : undefined,
    };
  });
  const byId = createMemo(() => new Map(rows().map((row) => [row.id, row])));
  const itemsById = createMemo(() =>
    Object.fromEntries(
      rows().flatMap(({ id, item }) => (item ? [[id, item]] : []))
    )
  );
  const projectedGroups = createKeyedProjection(
    bins,
    (bin) => bin.key,
    (bin): GroupMeta => {
      const itemIds = bin.items.flatMap((record) =>
        byId().get(record.id)?.item ? [record.id] : []
      );
      const first = itemsById()[itemIds[0] ?? ''];
      const resolved = resolveGroupMetaForKey(groupBy(), bin.key, first);
      return {
        key: bin.key,
        label: resolved?.label ?? bin.key,
        displayOrder: resolved?.displayOrder ?? null,
        totalCount: bin.totalCount,
        itemIds,
        nextCursor: bin.nextCursor ?? null,
      };
    }
  );
  const groups = createMemo(
    () => {
      const field = groupBy();
      return field
        ? [...projectedGroups()].sort(makeGroupComparator(field))
        : [];
    },
    undefined,
    { equals: arrayEquals }
  );
  const entities = createMemo(
    () =>
      groups().flatMap((group) =>
        group.itemIds.flatMap((id) => {
          const entity = byId().get(id)?.entity;
          return entity ? [entity] : [];
        })
      ),
    undefined,
    { equals: arrayEquals }
  );
  return createMemo(() =>
    source()
      ? { entities: entities(), groups: groups(), itemsById: itemsById() }
      : undefined
  );
}
