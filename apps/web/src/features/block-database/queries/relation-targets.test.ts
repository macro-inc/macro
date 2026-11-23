import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import { expect, it } from 'vitest';
import { relationTargets } from './relation-targets';

const database = (
  id: string,
  name: string,
  trashed_at: string | null = null
) => ({
  id,
  name,
  owner_id: 'macro|owner',
  project_id: null,
  created_at: '2026-11-01T00:00:00Z',
  trashed_at,
});
const table = (database_id: string, id: string, name: string) => ({
  database_id,
  id,
  name,
  position: 'a0',
  version: 1,
});

it('offers the open database first, then every other live database with tables, by name', () => {
  const open = {
    database: database('sales', 'Sales'),
    tables: [{ table: table('sales', 'deals', 'Deals') }],
  } as DatabaseDetail;
  const listed: ListedDatabase[] = [
    {
      database: database('sales', 'Sales'),
      grant: 'owner',
      tables: [table('sales', 'deals', 'Deals')],
    },
    {
      database: database('wiki', 'Wiki'),
      grant: 'view',
      tables: [table('wiki', 'pages', 'Pages')],
    },
    {
      database: database('crm', 'CRM'),
      grant: 'edit',
      tables: [table('crm', 'clients', 'Clients')],
    },
    {
      database: database('old', 'Old', '2026-10-01T00:00:00Z'),
      grant: 'owner',
      tables: [table('old', 'rows', 'Rows')],
    },
    { database: database('empty', 'Empty'), grant: 'owner', tables: [] },
  ];

  expect(relationTargets(open, listed)).toEqual({
    here: [{ databaseId: 'sales', tableId: 'deals', name: 'Deals' }],
    elsewhere: [
      {
        databaseId: 'crm',
        name: 'CRM',
        tables: [{ databaseId: 'crm', tableId: 'clients', name: 'Clients' }],
      },
      {
        databaseId: 'wiki',
        name: 'Wiki',
        tables: [{ databaseId: 'wiki', tableId: 'pages', name: 'Pages' }],
      },
    ],
  });
});
