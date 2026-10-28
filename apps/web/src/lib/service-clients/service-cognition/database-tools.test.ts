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
  tables: [
    {
      id: tableId,
      name: 'Tickets',
      sqlName: 'tickets',
      version: 1,
      writable: true,
      views: [],
      columns: [
        {
          id: columnId,
          name: 'Name',
          sqlName: 'name',
          dataType: 'text',
          writable: true,
          isMultiSelect: false,
          safeTypes: [],
          checkedTypes: [],
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
        results: [
          {
            columns: [{ name: 'Tickets', kind: 'number' }],
            rows: [[{ type: 'number', value: 12 }]],
            rowIds: [],
          },
        ],
        changesApplied: 0,
        readVersions: [],
        statement: { kind: 'select' },
        summary: 'Returned 1 row.',
      },
    },
    {
      name: 'SaveDatabaseView',
      json: {
        view: {
          id: columnId,
          databaseId,
          tableId,
          name: 'All tickets',
          position: '80',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-10-02T00:00:00Z',
          updatedAt: '2026-10-02T00:00:00Z',
        },
        created: true,
      },
    },
    {
      name: 'DeleteDatabaseView',
      json: {
        databaseId,
        tableId,
        viewId: columnId,
        name: 'All tickets',
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
