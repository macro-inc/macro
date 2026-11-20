import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { GroupSoupQuery } from '../../../service-clients/service-storage/graphql/generated/graphql';
import type { GraphqlSoupItem } from '../../../service-clients/service-storage/graphql-soup';

// Rows only need an id here; group labels and order come from the real
// grouped/api resolver, which is what this file checks.
vi.mock('../../../service-clients/service-storage/graphql-soup', () => ({
  mapGraphqlSoupItem: (item: GraphqlSoupItem) => ({ id: item.id }),
}));
vi.mock('../transform-utils', () => ({
  mapSoupPageToEntityList: (page: { items: unknown[] }) => page.items,
}));

import { createGraphqlGroupedSoupProjection } from './grouped-projection';
import { groupedDocument } from './grouped-test-fixtures';

type Bin = GroupSoupQuery['user']['groupSoup']['bins'][number];

function bins(list: Pick<Bin, 'key' | 'label' | 'displayOrder'>[]) {
  return {
    user: {
      id: 'viewer',
      groupSoup: {
        bins: list.map((bin, i) => ({
          ...bin,
          totalCount: 1,
          nextCursor: null,
          items: [groupedDocument(`row-${i}`)],
        })),
      },
    },
  } satisfies GroupSoupQuery;
}

function projectGroups(source: GroupSoupQuery) {
  return createRoot((dispose) => {
    const projected = createGraphqlGroupedSoupProjection(
      () => source,
      () => ({ type: 'entity_type' }),
      () => ({})
    );
    const groups = projected()?.groups?.map(({ key, label }) => ({
      key,
      label,
    }));
    dispose();
    return groups;
  });
}

describe('GraphQL lists grouped by entity type', () => {
  it('keep the label Soup gives calendar events', () => {
    expect(
      projectGroups(
        bins([
          { key: 'document', label: 'Documents', displayOrder: 0 },
          { key: 'calendar_event', label: 'Calendar', displayOrder: 2 },
        ])
      )
    ).toEqual([
      { key: 'document', label: 'Documents' },
      { key: 'calendar_event', label: 'Calendar' },
    ]);
  });

  it('order groups without a server rank as Soup does', () => {
    expect(
      projectGroups(
        bins([
          { key: 'channel', label: null, displayOrder: null },
          { key: 'calendar_event', label: null, displayOrder: null },
          { key: 'email', label: null, displayOrder: null },
        ])
      )?.map(({ key }) => key)
    ).toEqual(['email', 'calendar_event', 'channel']);
  });
});
