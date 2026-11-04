import { afterEach, expect, test } from 'bun:test';
import type { ColumnDetail, TableDetail } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function column(id: string, name: string, stage = false): ColumnDetail {
  return {
    column: {
      id,
      table_id: 'table',
      property_definition_id: `${id}-definition`,
      display_name: null,
      position: id,
      infer_type: false,
      config: null,
    },
    definition: {
      definition: {
        id: `${id}-definition`,
        display_name: name,
        data_type: stage ? 'SELECT_STRING' : 'NUMBER',
        is_multi_select: false,
        specific_entity_type: null,
        is_metadata: false,
        is_system: false,
        owner: { scope: 'database', database_id: 'database' },
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
      property_options: stage
        ? [
            {
              id: 'negotiation',
              property_definition_id: `${id}-definition`,
              value: { type: 'string', value: 'Negotiation' },
              display_order: 0,
              color: null,
              created_at: '2026-10-01T00:00:00Z',
              updated_at: '2026-10-01T00:00:00Z',
            },
          ]
        : [],
    },
    shared_outside_database: false,
    sql_name: id,
    writable: true,
  };
}
const table: TableDetail = {
  table: {
    id: 'table',
    database_id: 'database',
    name: 'Sales',
    position: 'a',
    version: 1,
  },
  columns: [
    column('stage', 'Sales phase', true),
    column('amount', 'Deal amount'),
  ],
  views: [],
  sql_name: 'sales',
};

test('stage rules use stable handles and reject fields from another pipeline before writing', async () => {
  const writes: unknown[] = [];
  let currentTable: TableDetail = { ...table, columns: [] };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.url.endsWith('/table')) return Response.json(currentTable);
      expect(new URL(request.url).pathname).toBe(
        '/crm/pipelines/sales/stage-requirements',
      );
      if (request.method === 'PUT') {
        writes.push(await request.json());
        return new Response(null, { status: 204 });
      }
      return Response.json([
        {
          stageColumnId: 'stage',
          stageId: 'negotiation',
          requiredColumnIds: ['amount'],
        },
      ]);
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const pipeline = macro.crm.pipelines.byId('sales');
  await pipeline.table();
  currentTable = table;
  const [rule] = await pipeline.stageRequirements();
  expect(await rule.stageColumn.name()).toBe('Sales phase');
  expect(await rule.requiredFields[0].name()).toBe('Deal amount');
  expect((await rule.stageColumn.options())[0].id).toBe(rule.stage.id);
  await pipeline.setStageRequirements(
    rule.stageColumn,
    rule.stage,
    rule.requiredFields,
  );
  await pipeline.setStageRequirements(rule.stageColumn, rule.stage, []);
  expect(writes).toEqual([
    {
      stageColumnId: 'stage',
      stageId: 'negotiation',
      requiredColumnIds: ['amount'],
    },
    { stageColumnId: 'stage', stageId: 'negotiation', requiredColumnIds: [] },
  ]);
  await expect(
    macro.crm.pipelines
      .byId('other')
      .setStageRequirements(rule.stageColumn, rule.stage, rule.requiredFields),
  ).rejects.toThrow('another pipeline');
  await expect(
    pipeline.setStageRequirements(rule.requiredFields[0], rule.stage, []),
  ).rejects.toThrow('another field');
  expect(writes).toHaveLength(2);
});
