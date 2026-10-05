import { createComputed, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { LiveQuery } from '../../../graphql-cache/exchange/live-query';
import { applyQueryPatches } from '../../../graphql-cache/exchange/query-patches';
import type { GroupSoupQuery } from '../../../service-clients/service-storage/graphql/generated/graphql';
import type { GraphqlSoupItem } from '../../../service-clients/service-storage/graphql-soup';

const mapItem = vi.hoisted(() =>
  vi.fn((item: GraphqlSoupItem) => ({
    id: item.id,
    name: ('properties' in item ? item.properties : undefined)
      ?.flatMap(({ value }) =>
        value?.__typename === 'GraphqlSelectOptionPropertyValue'
          ? value.optionIds
          : []
      )
      .join(','),
  }))
);
vi.mock('../../../service-clients/service-storage/graphql-soup', () => ({
  mapGraphqlSoupItem: mapItem,
}));
vi.mock('../transform-utils', () => ({
  mapSoupPageToEntityList: (page: { items: unknown[] }) => page.items,
}));
vi.mock('../grouped/api', () => ({
  makeGroupComparator: () => (a: { key: string }, b: { key: string }) =>
    a.key.localeCompare(b.key),
  resolveGroupMetaForKey: (_field: unknown, key: string) => ({ label: key }),
}));

import { createGraphqlGroupedSoupProjection } from './grouped-projection';

function row(
  id: number
): Extract<
  GroupSoupQuery['user']['groupSoup']['bins'][number]['items'][number],
  { __typename: 'GraphqlSoupDocument' }
> {
  return {
    __typename: 'GraphqlSoupDocument',
    id: String(id),
    entityType: 'DOCUMENT',
    displayName: String(id),
    documentName: String(id),
    ownerId: 'viewer',
    cacheProjection: null,
    frecencyScore: null,
    fileType: 'md',
    projectId: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    viewedAt: null,
    deletedAt: null,
    subType: { __typename: 'GraphqlTaskSubType', isCompleted: false },
    isFavorited: false,
    notifications: [],
    properties: [
      {
        id: `property-${id}`,
        propertyDefinitionId: 'status',
        displayName: 'Status',
        dataType: 'SELECT_STRING',
        isMultiSelect: false,
        specificEntityType: null,
        isSystem: true,
        isMetadata: false,
        value: {
          __typename: 'GraphqlSelectOptionPropertyValue',
          optionIds: ['initial'],
        },
      },
    ],
  };
}

function page(count: number): GroupSoupQuery {
  return {
    user: {
      id: 'viewer',
      groupSoup: {
        bins: [
          {
            key: 'a',
            totalCount: count,
            nextCursor: null,
            items: Array.from({ length: count }, (_, id) => row(id)),
          },
          { key: 'b', totalCount: 0, nextCursor: null, items: [] },
        ],
      },
    },
  };
}

describe('grouped Soup projections', () => {
  it('maps only the edited property owner among 1,000 rows and preserves unrelated subscribers', () => {
    createRoot((dispose) => {
      try {
        mapItem.mockClear();
        const initial = page(1000);
        const view = new LiveQuery(initial);
        const projected = createGraphqlGroupedSoupProjection(
          () => view.data as GroupSoupQuery,
          () => ({ type: 'property', propertyDefinitionId: 'status' }),
          () => ({ instructionsIdQuery: { isSuccess: false, data: undefined } })
        );
        const before = projected()!;
        const held = [...before.entities];
        let unrelatedReads = 0;
        let groupReads = 0;
        const seen: string[] = [];
        createComputed(() => seen.push(projected()!.entities[17].name));
        createComputed(() => {
          projected()!.entities[18].name;
          unrelatedReads++;
        });
        createComputed(() => {
          projected()!.groups?.[0].itemIds.join(',');
          groupReads++;
        });
        expect(mapItem).toHaveBeenCalledTimes(1000);
        for (const values of [['next'], ['second', 'third'], [], ['initial']]) {
          view.replace(
            applyQueryPatches(view.snapshot, [
              {
                path: [
                  'user',
                  'groupSoup',
                  'bins',
                  0,
                  'items',
                  17,
                  'properties',
                  0,
                  'value',
                  'optionIds',
                ],
                value: values,
              },
            ])
          );
          expect(projected()!.entities[17].name).toBe(values.join(','));
        }
        expect(mapItem).toHaveBeenCalledTimes(1004);
        expect(seen).toEqual([
          'initial',
          'next',
          'second,third',
          '',
          'initial',
        ]);
        expect(unrelatedReads).toBe(1);
        expect(groupReads).toBe(1);
        expect(
          projected()!.entities.every((entity, index) => entity === held[index])
        ).toBe(true);
        expect(projected()).toBe(before);
      } finally {
        dispose();
      }
    });
  });

  it('retains entities across group moves, removals, duplicate memberships and source replacement', () => {
    createRoot((dispose) => {
      try {
        const [source, setSource] = createSignal<GroupSoupQuery | undefined>(
          page(2)
        );
        const projected = createGraphqlGroupedSoupProjection(
          source,
          () => ({ type: 'property', propertyDefinitionId: 'status' }),
          () => ({ instructionsIdQuery: { isSuccess: false, data: undefined } })
        );
        const first = projected()!.entities[0];
        const next = page(2);
        const bins = next.user.groupSoup.bins;
        bins[1].items = [bins[0].items[0]];
        bins[1].totalCount = 1;
        setSource(next);
        expect(projected()!.groups?.map((group) => group.itemIds)).toEqual([
          ['0', '1'],
          ['0'],
        ]);
        expect(projected()!.entities[2]).toBe(first);
        const moved = structuredClone(next);
        moved.user.groupSoup.bins[0].items.shift();
        moved.user.groupSoup.bins[0].totalCount--;
        setSource(moved);
        expect(projected()!.entities.map(({ id }) => id)).toEqual(['1', '0']);
        expect(projected()!.entities[1]).toBe(first);
        setSource(undefined);
        expect(projected()).toBeUndefined();
        setSource(page(1));
        expect(projected()!.entities.map(({ id }) => id)).toEqual(['0']);
      } finally {
        dispose();
      }
    });
  });
});
