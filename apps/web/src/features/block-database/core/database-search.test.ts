import { describe, expect, it } from 'vitest';
import { databaseSearchGroups } from './database-search';

describe('database search groups', () => {
  it('lists each table with matches, the title first, the matched value cut down around the term', () => {
    expect(
      databaseSearchGroups('ada', [
        {
          tableId: 'parties',
          tableName: 'Parties',
          columns: [
            {
              id: 'name',
              name: 'Name',
              dataType: 'STRING',
              isMultiSelect: false,
              writable: true,
              options: [],
            },
          ],
          rows: [],
        },
        {
          tableId: 'invites',
          tableName: 'Invites',
          columns: [
            {
              id: 'guest',
              name: 'Guest',
              dataType: 'STRING',
              isMultiSelect: false,
              writable: true,
              options: [],
            },
            {
              id: 'notes',
              name: 'Notes',
              dataType: 'STRING',
              isMultiSelect: false,
              writable: true,
              options: [],
            },
          ],
          rows: [
            {
              rowId: 'invite-1',
              cells: { guest: 'Ada Lovelace', notes: null },
            },
            {
              rowId: 'invite-2',
              cells: {
                guest: 'Grace Hopper',
                notes:
                  'Bringing the analytical engine notes Ada wrote in 1843 for the whole party to read',
              },
            },
          ],
        },
      ])
    ).toEqual([
      {
        tableId: 'invites',
        tableName: 'Invites',
        matches: [
          {
            rowId: 'invite-1',
            title: 'Ada Lovelace',
            excerpt: {
              before: '',
              match: 'Ada',
              after: ' Lovelace',
            },
          },
          {
            rowId: 'invite-2',
            title: 'Grace Hopper',
            excerpt: {
              columnName: 'Notes',
              before: '…analytical engine notes ',
              match: 'Ada',
              after: ' wrote in 1843 for the whole party to read',
            },
          },
        ],
        more: 0,
      },
    ]);
  });

  it('lists a match whose term sits in markup without an excerpt', () => {
    expect(
      databaseSearchGroups('bold', [
        {
          tableId: 'invites',
          tableName: 'Invites',
          columns: [
            {
              id: 'guest',
              name: 'Guest',
              dataType: 'STRING',
              isMultiSelect: false,
              writable: true,
              options: [],
            },
          ],
          rows: [{ rowId: 'invite-1', cells: { guest: 'Ada' } }],
        },
      ])
    ).toEqual([
      {
        tableId: 'invites',
        tableName: 'Invites',
        matches: [{ rowId: 'invite-1', title: 'Ada' }],
        more: 0,
      },
    ]);
  });
});
