import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Campaign, Enrollment } from '../core/model';
import { createDatabaseMarketingRepository } from './database-repository';

const client = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  importTable: vi.fn(),
  applyOps: vi.fn(),
  queryRows: vi.fn(),
  /** A table's rows as text cells, by table id; served as one primary page. */
  read: vi.fn(),
}));
vi.mock('@service-storage/databases', () => ({ databasesClient: client }));

const campaign: Campaign = {
  id: 'campaign',
  name: 'Welcome',
  description: '',
  status: 'active',
  senderId: 'inbox',
  steps: [{ id: 'step', subject: 'Hello', body: 'Welcome', delayDays: 0 }],
  updatedAt: '2026-10-03T15:00:00Z',
};
const enrollment: Enrollment = {
  id: 'enrollment',
  campaignId: 'campaign',
  campaignName: 'Welcome',
  contact: {
    email: 'ada@example.com',
    name: 'Ada',
    crmContactId: 'crm-contact',
  },
  senderId: 'inbox',
  status: 'preparing',
  steps: [],
  createdAt: '2026-10-03T15:00:00Z',
  updatedAt: '2026-10-03T15:00:00Z',
};
/** Tables made before this change also carry Record ID, Status, and Contact email. */
function table(name: string, id: string, version: number, legacy = false) {
  const names = legacy
    ? ['Record ID', 'Name', 'Status', 'Contact email', 'Sequence data']
    : ['Name', 'Sequence data'];
  return {
    table: { id, name, version },
    columns: names.map((column) => ({
      column: {
        id: `${id}:${column}`,
        property_definition_id: `${id}:${column}:property`,
        display_name: column,
      },
      definition: { definition: { display_name: column } },
    })),
  };
}
const tables = [
  table('Email campaigns', 'campaign-table', 7, true),
  table('Sequence enrollments', 'enrollment-table', 12, true),
  table('Unsubscribed contacts', 'unsubscribe-table', 3),
];
const TABLE_NAMES = tables.map((entry) => entry.table.name);
type TextRow = { rowId: string; name?: string; data?: string };
const text = (value: string) => ({ type: 'String', value });
/** One page of rows the way the rows route answers, at the table's version. */
async function rowsPage({
  tableId,
}: {
  tableId: string;
  request: { after?: string };
}) {
  const rows: TextRow[] = await client.read(tableId);
  return ok({
    version: tables.find((entry) => entry.table.id === tableId)?.table.version,
    rows: rows.map((row) => ({
      rowId: row.rowId,
      cells: {
        ...(row.name === undefined
          ? {}
          : { [`${tableId}:Name`]: text(row.name) }),
        ...(row.data === undefined
          ? {}
          : { [`${tableId}:Sequence data`]: text(row.data) }),
      },
    })),
  });
}
function listed(
  id: string,
  createdAt: string,
  grant: string,
  tableNames: string[],
  name = 'Email Marketing'
) {
  return {
    database: { id, name, trashed_at: null, created_at: createdAt },
    grant,
    tables: tableNames.map((tableName) => ({ name: tableName })),
  };
}
function detail(value = tables) {
  return ok({
    database: { id: 'database' },
    grant: 'owner',
    tables: structuredClone(value),
  });
}
const cell = (call: number, column: string) =>
  client.applyOps.mock.calls[call][0].request.ops[0].change.rows[0].find(
    (entry: { column: string }) => entry.column === column
  )?.value;

beforeEach(() => {
  vi.clearAllMocks();
  client.list.mockResolvedValue(
    ok([listed('database', '2026-10-01T00:00:00Z', 'owner', TABLE_NAMES)])
  );
  client.get.mockImplementation(async () => detail());
  client.queryRows.mockImplementation(rowsPage);
  client.read.mockImplementation(async (id: string) =>
    id === 'campaign-table'
      ? [
          {
            rowId: 'campaign-row',
            name: 'Welcome',
            data: JSON.stringify(campaign),
          },
        ]
      : []
  );
  client.importTable.mockResolvedValue(ok({}));
  client.applyOps.mockResolvedValue(
    ok({
      changes: [{ table: 'enrollment-table', version: 13 }],
      results: [
        {
          kind: 'rows',
          change: { kind: 'inserted', rows: ['enrollment-row'] },
        },
      ],
    })
  );
});

describe('Macro Databases sequence records', () => {
  it('writes a readable name and the record, guards every table version, and reuses the row handle', async () => {
    const repository = createDatabaseMarketingRepository();
    await repository.load();
    await repository.saveEnrollment(enrollment);
    const first = client.applyOps.mock.calls[0][0];
    expect(first.request.baseVersions).toEqual({
      'campaign-table': 7,
      'enrollment-table': 12,
      'unsubscribe-table': 3,
    });
    // Only Name and Sequence data are written; the legacy columns stay empty.
    expect(first.request.ops[0].change.rows[0]).toHaveLength(2);
    expect(cell(0, 'enrollment-table:Name')).toEqual({
      type: 'text',
      value: 'ada@example.com',
    });
    expect(
      JSON.parse(cell(0, 'enrollment-table:Sequence data').value).contact
        .crmContactId
    ).toBe('crm-contact');
    await repository.saveEnrollment({ ...enrollment, status: 'scheduled' });
    const second = client.applyOps.mock.calls[1][0].request;
    expect(second.baseVersions['enrollment-table']).toBe(13);
    expect(second.ops[0].change.changes.rows).toEqual(['enrollment-row']);
  });
  it('guards writes with the versions its rows were read at, so a just-written row is never missing', async () => {
    // The schema read lags; the rows read is newer and holds the new row.
    client.queryRows.mockImplementation(async (request) => {
      const page = await rowsPage(request);
      return request.tableId === 'enrollment-table'
        ? page.map((value) => ({ ...value, version: 14 }))
        : page;
    });
    const repository = createDatabaseMarketingRepository();
    await repository.load();
    await repository.saveCampaign(campaign);
    expect(
      client.applyOps.mock.calls[0][0].request.baseVersions['enrollment-table']
    ).toBe(14);
  });

  it('reads a table again when a write lands during the read', async () => {
    client.queryRows
      .mockResolvedValueOnce(err([{ code: 'CONFLICT', message: '409' }]))
      .mockImplementation(rowsPage);
    const snapshot = await createDatabaseMarketingRepository().load();
    expect(snapshot.campaigns).toEqual([campaign]);
    expect(client.queryRows).toHaveBeenCalledTimes(4);
  });

  it('still finds its tables and columns after a case-only rename', async () => {
    const renamed = structuredClone(tables);
    renamed[0].table.name = 'EMAIL CAMPAIGNS';
    for (const entry of renamed[0].columns)
      entry.column.display_name = entry.column.display_name.toLowerCase();
    client.list.mockResolvedValue(
      ok([
        listed('database', '2026-10-01T00:00:00Z', 'owner', [
          'EMAIL CAMPAIGNS',
          'sequence enrollments',
        ]),
      ])
    );
    client.get.mockImplementation(async () => detail(renamed));
    const repository = createDatabaseMarketingRepository();
    expect((await repository.load()).campaigns).toEqual([campaign]);
    await repository.saveCampaign(campaign);
    // The table counts as present: no import of a second copy.
    expect(client.importTable).not.toHaveBeenCalled();
  });
  it('reports a version conflict as a change elsewhere, without retrying the insert', async () => {
    const repository = createDatabaseMarketingRepository();
    await repository.load();
    client.applyOps.mockResolvedValue(
      err([{ code: 'CONFLICT', message: 'Table changed', refusal: null }])
    );
    await expect(repository.saveEnrollment(enrollment)).rejects.toMatchObject({
      code: 'changedElsewhere',
    });
    expect(client.applyOps).toHaveBeenCalledTimes(1);
  });
  it('finds its own database by its tables, even renamed, choosing the oldest and ignoring shared ones', async () => {
    client.list.mockResolvedValue(
      ok([
        listed('shared', '2026-01-01T00:00:00Z', 'edit', TABLE_NAMES),
        listed('newer', '2026-10-02T00:00:00Z', 'owner', TABLE_NAMES),
        listed(
          'renamed',
          '2026-10-01T00:00:00Z',
          'owner',
          TABLE_NAMES,
          'Outreach'
        ),
        listed(
          'unrelated',
          '2025-01-01T00:00:00Z',
          'owner',
          ['Table 1'],
          'Notes'
        ),
        // Shares one table name with ours, but holds other data.
        listed(
          'lookalike',
          '2025-01-01T00:00:00Z',
          'owner',
          ['Email campaigns'],
          'Newsletter'
        ),
      ])
    );
    const snapshot = await createDatabaseMarketingRepository().load();
    expect(snapshot.databaseId).toBe('renamed');
    expect(client.get).toHaveBeenCalledWith({ id: 'renamed' });
  });
});
