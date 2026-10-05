import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from './database-view';
import {
  allRecordsView,
  boardGroupColumns,
  laneLabel,
  laneValue,
  layoutColumns,
  movedViewOrder,
  withLaneHidden,
  withLaneOrder,
  withLayoutColumn,
  withLayoutOrder,
  withoutColumn,
} from './views';

const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const rsvp: DatabaseViewColumn = {
  id: 'rsvp',
  name: 'RSVP',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const guests: DatabaseViewColumn = {
  id: 'guests',
  name: 'Guests',
  dataType: 'NUMBER',
  isMultiSelect: false,
  options: [],
  writable: true,
};

describe('table layouts', () => {
  it('shows listed columns first, then the rest in table order', () => {
    expect(
      layoutColumns(
        {
          kind: 'table',
          columns: [{ column: 'guests', width: 120 }],
        },
        [name, rsvp, guests]
      )
    ).toEqual([
      { column: guests, width: 120 },
      { column: name, width: null },
      { column: rsvp, width: null },
    ]);
  });

  it('writes every column when one is resized', () => {
    expect(
      withLayoutColumn(
        {
          kind: 'table',
          columns: [{ column: 'rsvp', width: 160 }],
        },
        [name, rsvp],
        'name',
        { width: 240 }
      )
    ).toEqual({
      kind: 'table',
      columns: [
        { column: 'rsvp', width: 160 },
        { column: 'name', width: 240 },
      ],
    });
  });

  it('reorders columns, keeping each one width', () => {
    expect(
      withLayoutOrder(
        {
          kind: 'table',
          columns: [{ column: 'name', width: 200 }],
        },
        [name, rsvp, guests],
        ['rsvp', 'name']
      )
    ).toEqual({
      kind: 'table',
      columns: [
        { column: 'rsvp', width: null },
        { column: 'name', width: 200 },
        { column: 'guests', width: null },
      ],
    });
  });
});

const board: Extract<ViewLayout, { kind: 'board' }> = {
  kind: 'board',
  groupBy: 'rsvp',
  title: 'name',
  lanes: [{ key: { kind: 'option', id: 'yes' }, hidden: true }],
  cardFields: ['guests'],
  hideEmptyLanes: false,
};

describe('board lanes', () => {
  it('reorders every lane, keeping a hidden lane hidden', () => {
    expect(
      withLaneOrder(board, [
        { kind: 'none' },
        { kind: 'option', id: 'no' },
        { kind: 'option', id: 'yes' },
      ])
    ).toEqual({
      ...board,
      lanes: [
        { key: { kind: 'none' }, hidden: false },
        { key: { kind: 'option', id: 'no' }, hidden: false },
        { key: { kind: 'option', id: 'yes' }, hidden: true },
      ],
    });
  });

  it('hides a lane it does not list yet, and shows a listed one again', () => {
    expect(withLaneHidden(board, { kind: 'none' }, true).lanes).toEqual([
      { key: { kind: 'option', id: 'yes' }, hidden: true },
      { key: { kind: 'none' }, hidden: true },
    ]);
    expect(
      withLaneHidden(board, { kind: 'option', id: 'yes' }, false).lanes
    ).toEqual([{ key: { kind: 'option', id: 'yes' }, hidden: false }]);
  });
});

describe('a removed column', () => {
  it('leaves the conditions, sort and card fields that named it', () => {
    expect(
      withoutColumn(
        {
          id: 'view',
          databaseId: 'database',
          tableId: 'table',
          name: 'Board',
          position: 'a0',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
          query: {
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  kind: 'group',
                  conjunction: 'or',
                  conditions: [
                    {
                      kind: 'condition',
                      column: 'guests',
                      test: { kind: 'presence', operator: 'isEmpty' },
                    },
                  ],
                },
                {
                  kind: 'condition',
                  column: 'name',
                  test: { kind: 'presence', operator: 'isEmpty' },
                },
              ],
            },
            sort: [{ column: 'guests', direction: 'ascending' }],
          },
          layout: board,
        },
        'guests'
      )
    ).toEqual(
      ok({
        id: 'view',
        databaseId: 'database',
        tableId: 'table',
        name: 'Board',
        position: 'a0',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
        query: {
          filter: {
            conjunction: 'and',
            conditions: [
              {
                kind: 'condition',
                column: 'name',
                test: { kind: 'presence', operator: 'isEmpty' },
              },
            ],
          },
          sort: [],
        },
        layout: { ...board, cardFields: [] },
      })
    );
  });

  it('cannot leave a board without the column it groups by', () => {
    expect(
      withoutColumn(
        {
          id: 'view',
          databaseId: 'database',
          tableId: 'table',
          name: 'Board',
          position: 'a0',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
          query: { filter: null, sort: [] },
          layout: board,
        },
        'rsvp'
      )
    ).toEqual(err({ kind: 'board-groups-by-column' }));
  });
});

describe('reordering view tabs', () => {
  it('puts a dragged tab in the place of the tab it is dropped on, either way', () => {
    expect(
      movedViewOrder(['first', 'second', 'third'], 'third', 'first')
    ).toEqual(['third', 'first', 'second']);
    expect(
      movedViewOrder(['first', 'second', 'third'], 'first', 'third')
    ).toEqual(['second', 'third', 'first']);
  });

  it('keeps the order for a drop on itself or an unknown tab', () => {
    expect(movedViewOrder(['first', 'second'], 'first', 'first')).toEqual([
      'first',
      'second',
    ]);
    expect(movedViewOrder(['first', 'second'], 'first', 'gone')).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('allRecordsView', () => {
  it('is the whole table, unfiltered and unsorted, at the first key the engine reads', () => {
    expect(
      allRecordsView({ id: 'guests-table', database_id: 'party' })
    ).toEqual({
      id: 'guests-table',
      databaseId: 'party',
      tableId: 'guests-table',
      name: 'All records',
      // `key_between(None, None)`: the engine refuses a view whose position
      // is not a minted key, and an empty string is not one.
      position: '80',
      query: { filter: null, sort: [] },
      layout: { kind: 'table', columns: [] },
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
  });
});

describe('a board grouped by people', () => {
  const owner: DatabaseViewColumn = {
    id: 'owner',
    name: 'Owner',
    dataType: 'ENTITY',
    specificEntityType: 'USER',
    isMultiSelect: false,
    options: [],
    writable: true,
  };

  it('groups by a single select or a single person, and nothing else', () => {
    const columns: DatabaseViewColumn[] = [
      owner,
      { ...owner, id: 'reviewers', name: 'Reviewers', isMultiSelect: true },
      {
        ...owner,
        id: 'doc',
        name: 'Doc',
        specificEntityType: 'DOCUMENT',
      },
      {
        id: 'status',
        name: 'Status',
        dataType: 'SELECT_STRING',
        isMultiSelect: false,
        options: [],
        writable: true,
      },
      {
        id: 'labels',
        name: 'Labels',
        dataType: 'SELECT_STRING',
        isMultiSelect: true,
        options: [],
        writable: true,
      },
    ];

    expect(boardGroupColumns(columns).map((column) => column.id)).toEqual([
      'owner',
      'status',
    ]);
  });

  it('names a person lane by their email and the empty lane by the column', () => {
    expect(laneLabel(owner, { kind: 'user', id: 'macro|sam@macro.com' })).toBe(
      'sam@macro.com'
    );
    expect(laneLabel(owner, { kind: 'none' })).toBe('No owner');
  });

  it('starts a card created in a person lane with that person', () => {
    expect(laneValue(owner, { kind: 'user', id: 'macro|sam@macro.com' })).toBe(
      'macro|sam@macro.com'
    );
    expect(laneValue(owner, { kind: 'none' })).toBeUndefined();
  });
});
