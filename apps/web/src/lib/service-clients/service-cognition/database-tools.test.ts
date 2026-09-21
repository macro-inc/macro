import { describe, expect, it } from 'vitest';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type ToolName,
} from './generated/tools/tool';

const databaseId = '01a0c45a-b571-73cc-a906-a6fac862a8ca';
const tableId = '01a0c45a-b572-7157-8dd7-c328b6b3e472';
const columnId = '01a0c45a-b5aa-7056-b669-525e0a11f46e';
const database = {
  id: databaseId,
  name: 'Support',
  grant: 'owner',
  magicTables: '',
  sqlGuide: '',
  tables: [
    {
      id: tableId,
      name: 'Tickets',
      sqlName: 'tickets',
      readSqlName: '_macro_table_01a0c45ab57271578dd7c328b6b3e472',
      version: 1,
      writable: true,
      columns: [
        {
          id: columnId,
          name: 'Name',
          sqlName: 'name',
          dataType: 'text',
          writable: true,
          isMultiSelect: false,
          // Actual text columns omit options, entity type, and relation metadata.
        },
      ],
    },
  ],
};

describe('database tool output contracts', () => {
  const examples: { name: ToolName; json: unknown }[] = [
    {
      name: 'ListDatabases',
      json: { databases: [], summary: 'No databases found.' },
    },
    { name: 'DescribeDatabase', json: database },
    {
      name: 'QueryDatabase',
      json: {
        results: [{ columns: [{ name: 'Tickets' }], rows: [[12]] }],
        changesApplied: 0,
        readVersions: [],
        summary: 'Returned 1 row.',
      },
    },
    {
      name: 'CreateDatabase',
      json: { id: databaseId, name: 'Support', database },
    },
    { name: 'CreateTable', json: { databaseId, tableId, database } },
    { name: 'AddColumn', json: { databaseId, tableId, columnId, database } },
    {
      name: 'AddColumnOptions',
      json: { databaseId, tableId, columnId, options: [], database },
    },
    {
      name: 'SaveDatabaseView',
      json: {
        viewId: columnId,
        databaseId,
        tableId,
        name: 'All tickets',
        config: {},
        created: true,
      },
    },
  ];
  it.each(examples)(
    'parses $name with omitted empty optional metadata',
    ({ name, json }) => {
      expect(
        deserializeToolResponse({ id: 'tool-call', name, json }).isOk()
      ).toBe(true);
    }
  );
  it.each([
    'CreateDatabase',
    'CreateTable',
    'AddColumn',
    'AddColumnOptions',
  ] as const)(
    'keeps a committed %s result valid when its follow-up schema is unavailable',
    (name) => {
      const json = {
        id: databaseId,
        name: 'Support',
        databaseId,
        tableId,
        columnId,
        options: [],
        warning: 'Saved; refresh the database to continue.',
      };
      expect(
        deserializeToolResponse({ id: 'tool-call', name, json }).isOk()
      ).toBe(true);
    }
  );
});

describe('native database display hints', () => {
  it.each([undefined, 'table', 'scalar', 'bar', 'line', 'pie'])(
    'accepts the optional %s presentation without changing SQL',
    (display) => {
      const result = deserializeToolCall({
        id: 'query',
        name: 'QueryDatabase',
        json: { sql: 'SELECT 12', ...(display ? { display } : {}) },
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk())
        expect(result.value.data).toEqual({
          sql: 'SELECT 12',
          ...(display ? { display } : {}),
        });
    }
  );
  it('rejects a display type the native renderer cannot support', () => {
    expect(
      deserializeToolCall({
        id: 'query',
        name: 'QueryDatabase',
        json: { sql: 'SELECT 12', display: 'heatmap' },
      }).isErr()
    ).toBe(true);
  });
});
