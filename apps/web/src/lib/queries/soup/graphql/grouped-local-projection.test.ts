import { describe, expect, it } from 'vitest';
import { parseCacheRevision } from '../../../graphql-cache/protocol';
import type {
  GroupedSoupInitialInput,
  GroupSoupQuery,
  SoupItemFieldsFragment,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import {
  localSoupGroupKeys,
  mergeGroupedSoupBins,
  projectLocalGroupedSoup,
} from './grouped-local-projection';
import { groupedDocument } from './grouped-test-fixtures';
import { soupItemKey } from './reconciliation';

const input: GroupedSoupInitialInput = {
  groupBy: { field: 'PROPERTY', propertyDefinitionId: 'status-definition' },
  sortMethod: 'UPDATED_AT',
};
const now = new Date('2026-10-10T12:00:00Z');

function snapshot(
  records: SoupItemFieldsFragment[],
  retainedKeys: string[] = []
) {
  return {
    revision: parseCacheRevision('1'),
    optimistic: false,
    keys: [...records.map(soupItemKey), ...retainedKeys],
    retainedKeys,
    records: records.map((record) => ({
      recordKey: soupItemKey(record),
      record,
    })),
  };
}

describe('loaded grouped pages', () => {
  it('merges overlapping pages without rescanning earlier item identities', () => {
    let identityReads = 0;
    const items = Array.from({ length: 200 }, (_, index) => ({
      ...groupedDocument(String(index)),
      get id() {
        identityReads += 1;
        return String(index);
      },
    }));
    const pages: GroupSoupQuery[] = Array.from({ length: 20 }, (_, index) => ({
      user: {
        id: 'viewer',
        groupSoup: {
          bins: [
            {
              key: 'todo',
              totalCount: 300 - index * 10,
              nextCursor: `page-${index + 1}`,
              items: items.slice(index * 10, index * 10 + 10),
            },
          ],
        },
      },
    }));
    pages.push({
      user: {
        id: 'viewer',
        groupSoup: {
          bins: [
            {
              key: 'todo',
              totalCount: 0,
              nextCursor: null,
              items: [groupedDocument('0', ['done'])],
            },
          ],
        },
      },
    });
    const merged = mergeGroupedSoupBins(pages);
    expect(identityReads).toBeLessThanOrEqual(items.length * 2);
    expect(merged).toHaveLength(1);
    expect(merged[0].items).toHaveLength(200);
    expect(merged[0].items[0]).toBe(items[0]);
    expect(merged[0].items[199]).toBe(items[199]);
    expect(merged[0].totalCount).toBe(300);
    expect(merged[0].nextCursor).toBe('page-1');
    expect(pages[0].user.groupSoup.bins[0].items).toHaveLength(10);
  });
});

describe('local grouped Soup projection', () => {
  it('retains server membership for an unfamiliar grouping while refreshing rows', () => {
    const before = groupedDocument('a');
    const next = { ...groupedDocument('a', ['done']), displayName: 'Updated' };
    const fromNewerServer = JSON.parse('"ASSIGNEE"');

    expect(
      projectLocalGroupedSoup(
        [
          {
            key: 'server-group',
            items: [before],
            totalCount: 30,
            nextCursor: 'more',
          },
        ],
        new Map(),
        snapshot([next]),
        { ...input, groupBy: { field: fromNewerServer } },
        now
      )
    ).toEqual([
      {
        key: 'server-group',
        items: [next],
        totalCount: 30,
        nextCursor: 'more',
      },
    ]);
  });

  it('moves normalized rows and removes filter nonmatches without losing unknown rows', () => {
    const a = groupedDocument('a');
    const b = groupedDocument('b');
    const unknown = groupedDocument('unknown');
    const baseline = [
      {
        key: 'todo',
        items: [a, b, unknown],
        totalCount: 30,
        nextCursor: 'more',
      },
    ];
    const next = groupedDocument('a', ['done']);
    const result = projectLocalGroupedSoup(
      baseline,
      new Map(),
      snapshot([next], [soupItemKey(unknown)]),
      input,
      now
    );
    expect(result).toEqual([
      { key: 'todo', items: [unknown], totalCount: 28, nextCursor: 'more' },
      { key: 'done', items: [next], totalCount: 1, nextCursor: null },
    ]);
    expect(result[1].items[0]).toBe(next);
    expect(baseline[0].items).toEqual([a, b, unknown]);
  });

  it('prefers selected then current display fields without changing baseline membership', () => {
    const selectedBefore = groupedDocument('selected');
    const retained = groupedDocument('retained');
    const missing = groupedDocument('missing');
    const excluded = groupedDocument('excluded');
    const selected = { ...selectedBefore, displayName: 'Selected name' };
    const current = {
      ...groupedDocument('retained', ['done']),
      displayName: 'Current name',
    };
    const currentItems = new Map([
      [
        soupItemKey(selectedBefore),
        { ...selectedBefore, displayName: 'Older name' },
      ],
      [soupItemKey(retained), current],
      [soupItemKey(excluded), excluded],
    ]);
    expect(
      projectLocalGroupedSoup(
        [
          {
            key: 'todo',
            items: [selectedBefore, retained, missing, excluded],
            totalCount: 30,
            nextCursor: 'more',
          },
        ],
        currentItems,
        snapshot([selected], [soupItemKey(retained), soupItemKey(missing)]),
        input,
        now
      )
    ).toEqual([
      {
        key: 'todo',
        items: [selected, current, missing],
        totalCount: 29,
        nextCursor: 'more',
      },
    ]);
  });

  it('uses complete old multi-value membership rather than just loaded bins for count deltas', () => {
    const before = groupedDocument('a', ['todo', 'done']);
    const after = groupedDocument('a', ['done']);
    expect(
      projectLocalGroupedSoup(
        [
          {
            key: 'todo',
            items: [before],
            totalCount: 30,
            nextCursor: 'todo-more',
          },
          { key: 'done', items: [], totalCount: 20, nextCursor: 'done-more' },
        ],
        new Map(),
        snapshot([after]),
        input,
        now
      )
    ).toEqual([
      { key: 'todo', items: [], totalCount: 29, nextCursor: 'todo-more' },
      { key: 'done', items: [after], totalCount: 20, nextCursor: 'done-more' },
    ]);
  });

  it('ignores bounded flat candidates outside the baseline', () => {
    expect(
      projectLocalGroupedSoup(
        [],
        new Map(),
        snapshot([groupedDocument('new')]),
        input,
        now
      )
    ).toEqual([]);
  });

  it('moves date buckets at midnight using the actual previous bin, not a recomputed old bucket', () => {
    const row = { ...groupedDocument('a'), updatedAt: '2026-10-09T23:30:00Z' };
    expect(
      projectLocalGroupedSoup(
        [{ key: 'today', items: [row], totalCount: 8, nextCursor: 'more' }],
        new Map(),
        snapshot([row]),
        { ...input, groupBy: { field: 'DATE' } },
        now
      )
    ).toEqual([
      { key: 'today', items: [], totalCount: 7, nextCursor: 'more' },
      { key: 'yesterday', items: [row], totalCount: 1, nextCursor: null },
    ]);
  });

  it.each([
    ['2026-10-11T00:00:00Z', 'this_week'],
    ['2026-10-10T00:00:00Z', 'today'],
    ['2026-10-09T00:00:00Z', 'yesterday'],
    ['2026-10-04T00:00:00Z', 'this_week'],
    ['2026-10-03T00:00:00Z', 'last_week'],
    ['2026-09-27T00:00:00Z', 'last_week'],
    ['2026-09-26T00:00:00Z', 'this_month'],
    ['2026-09-10T00:00:00Z', 'this_month'],
    ['2026-09-09T00:00:00Z', 'last_month'],
    ['2026-08-11T00:00:00Z', 'last_month'],
    ['2026-08-10T00:00:00Z', 'older'],
  ])('matches grouped SQL date boundaries for %s', (updatedAt, key) => {
    expect(
      localSoupGroupKeys(
        { ...groupedDocument('a'), updatedAt },
        { ...input, groupBy: { field: 'DATE' } },
        now
      )
    ).toEqual([key]);
  });

  it('matches canonical property entity scopes and preserves unsupported viewed-date grouping', () => {
    expect(
      localSoupGroupKeys(
        groupedDocument('a'),
        { ...input, groupBy: { ...input.groupBy, entityType: 'TASK' } },
        now
      )
    ).toEqual(['todo']);
    expect(
      localSoupGroupKeys(
        groupedDocument('a'),
        { ...input, groupBy: { ...input.groupBy, entityType: 'DOCUMENT' } },
        now
      )
    ).toEqual(['']);
    expect(
      localSoupGroupKeys(
        groupedDocument('a'),
        { groupBy: { field: 'DATE' }, sortMethod: 'VIEWED_UPDATED' },
        now
      )
    ).toBeUndefined();
  });

  it('distinguishes known empty property values from unknown grouping evidence', () => {
    expect(localSoupGroupKeys(groupedDocument('a', []), input, now)).toEqual([
      '',
    ]);
    expect(
      localSoupGroupKeys(
        { ...groupedDocument('a'), projectId: 'project-2' },
        { ...input, groupBy: { field: 'PROJECT' } },
        now
      )
    ).toEqual(['project-2']);
    const linked = groupedDocument('a');
    linked.properties[0].value = {
      __typename: 'GraphqlLinkPropertyValue',
      urls: ['https://example.com', 'https://example.com'],
    };
    expect(localSoupGroupKeys(linked, input, now)).toEqual([
      'https://example.com',
    ]);
    linked.properties[0].value = {
      __typename: 'GraphqlNumberPropertyValue',
      numberValue: 3,
    };
    expect(localSoupGroupKeys(linked, input, now)).toEqual(['']);
  });
});
