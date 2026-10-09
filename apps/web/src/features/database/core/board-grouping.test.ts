import { describe, expect, it } from 'vitest';
import {
  boardWithStatusColumn,
  newBoardWithStatusColumn,
  statusColumnName,
} from './board-grouping';
import type { DatabaseViewColumn } from './database-view';

const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};

describe('a board grouped by a new Status column', () => {
  it('creates the column and the board in one batch, under the ids minted for them', () => {
    expect(
      newBoardWithStatusColumn({
        tableId: 'tasks',
        viewId: 'board',
        name: 'Board view',
        query: { filter: null, sort: [] },
        columns: [name],
        status: { column: 'status', options: ['todo', 'doing', 'done'] },
      })
    ).toEqual([
      {
        kind: 'column',
        table: 'tasks',
        column: 'status',
        change: {
          kind: 'create',
          definition: {
            source: 'new',
            name: 'Status',
            type: { type: 'select', multi: false },
            options: [
              { id: 'todo', label: 'To do' },
              { id: 'doing', label: 'In progress' },
              { id: 'done', label: 'Done' },
            ],
          },
        },
      },
      {
        kind: 'view',
        table: 'tasks',
        view: 'board',
        change: {
          kind: 'create',
          view: {
            name: 'Board view',
            query: { filter: null, sort: [] },
            layout: {
              kind: 'board',
              groupBy: 'status',
              title: 'name',
              lanes: [],
              cardFields: [],
              hideEmptyLanes: false,
            },
          },
        },
      },
    ]);
  });

  it('turns a view into a board in one batch with the column', () => {
    expect(
      boardWithStatusColumn({
        view: {
          id: 'grid',
          databaseId: 'plans',
          tableId: 'tasks',
          name: 'Everything',
          position: '80',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
        columns: [name],
        status: { column: 'status', options: ['todo', 'doing', 'done'] },
      })
    ).toEqual([
      {
        kind: 'column',
        table: 'tasks',
        column: 'status',
        change: {
          kind: 'create',
          definition: {
            source: 'new',
            name: 'Status',
            type: { type: 'select', multi: false },
            options: [
              { id: 'todo', label: 'To do' },
              { id: 'doing', label: 'In progress' },
              { id: 'done', label: 'Done' },
            ],
          },
        },
      },
      {
        kind: 'view',
        table: 'tasks',
        view: 'grid',
        change: {
          kind: 'update',
          layout: {
            kind: 'board',
            groupBy: 'status',
            title: 'name',
            lanes: [],
            cardFields: [],
            hideEmptyLanes: false,
          },
        },
      },
    ]);
  });

  it('takes the next free name when the table has a Status already', () => {
    expect(
      statusColumnName([
        name,
        { ...name, id: 'status', name: 'status' },
        { ...name, id: 'status-2', name: 'Status 2' },
      ])
    ).toBe('Status 3');
  });
});
