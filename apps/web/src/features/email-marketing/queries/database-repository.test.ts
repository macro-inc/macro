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
  read: vi.fn(),
}));
vi.mock('@service-storage/databases', () => ({ databasesClient: client }));
vi.mock('./database-rows', () => ({ readMarketingTable: client.read }));

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
  it('counts unreadable rows instead of failing the load, and ignores empty ones', async () => {
    client.read.mockImplementation(async (id: string) =>
      id === 'enrollment-table'
        ? [
            { rowId: 'empty', name: undefined, data: undefined },
            { rowId: 'broken-json', data: '{"id":' },
            { rowId: 'wrong-shape', data: '{"status":"active"}' },
            { rowId: 'good', data: JSON.stringify(enrollment) },
          ]
        : []
    );
    const snapshot = await createDatabaseMarketingRepository().load();
    expect(snapshot.unreadable).toBe(2);
    expect(snapshot.enrollments.map((entry) => entry.id)).toEqual([
      'enrollment',
    ]);
  });
  it('takes a campaign’s name from its Name cell, so a rename in the database view sticks', async () => {
    client.read.mockImplementation(async (id: string) =>
      id === 'campaign-table'
        ? [
            {
              rowId: 'campaign-row',
              name: '  Renamed  ',
              data: JSON.stringify(campaign),
            },
          ]
        : []
    );
    const snapshot = await createDatabaseMarketingRepository().load();
    expect(snapshot.campaigns[0].name).toBe('Renamed');
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
  it('does not write through a database it can only view', async () => {
    client.get.mockResolvedValue(
      ok({ grant: 'view', database: { id: 'database' }, tables })
    );
    const repository = createDatabaseMarketingRepository();
    expect((await repository.load()).writable).toBe(false);
    await expect(repository.saveCampaign(campaign)).rejects.toMatchObject({
      code: 'needEditAccess',
    });
    expect(client.applyOps).not.toHaveBeenCalled();
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
  it('creates its own database with every table when only a shared one exists', async () => {
    const shared = ok([
      listed('shared', '2026-01-01T00:00:00Z', 'edit', TABLE_NAMES),
    ]);
    // Two reads before setup; afterwards the new database is listed.
    client.list.mockResolvedValueOnce(shared).mockResolvedValueOnce(shared);
    client.create.mockResolvedValue(ok({ id: 'database' }));
    const repository = createDatabaseMarketingRepository();
    expect((await repository.load()).databaseId).toBeUndefined();
    await repository.saveCampaign(campaign);
    expect(client.applyOps).toHaveBeenCalledTimes(1);
    expect(client.create).toHaveBeenCalledWith({ name: 'Email Marketing' });
    expect(
      client.importTable.mock.calls.map((call) => [
        call[0].request.name,
        call[0].request.columns,
      ])
    ).toEqual(TABLE_NAMES.map((name) => [name, ['Name', 'Sequence data']]));
  });
  it('finishes an interrupted setup instead of failing every later load', async () => {
    client.list.mockResolvedValue(
      ok([listed('database', '2026-10-01T00:00:00Z', 'owner', ['Table 1'])])
    );
    client.get
      .mockResolvedValueOnce(detail([]))
      .mockResolvedValueOnce(detail([]));
    const repository = createDatabaseMarketingRepository();
    expect(await repository.load()).toMatchObject({
      campaigns: [],
      enrollments: [],
    });
    await repository.saveCampaign(campaign);
    expect(client.create).not.toHaveBeenCalled();
    expect(
      client.importTable.mock.calls.map((call) => call[0].request.name)
    ).toEqual(TABLE_NAMES);
    expect(client.applyOps).toHaveBeenCalledTimes(1);
  });
  it('adds the unsubscribed table to an existing database on its first write', async () => {
    client.get
      .mockResolvedValueOnce(detail(tables.slice(0, 2)))
      .mockResolvedValueOnce(detail(tables.slice(0, 2)));
    const repository = createDatabaseMarketingRepository();
    expect((await repository.load()).unsubscribed).toEqual([]);
    await repository.saveUnsubscribe({
      email: 'ada@example.com',
      unsubscribedAt: '2026-10-30T00:00:00Z',
    });
    expect(
      client.importTable.mock.calls.map((call) => call[0].request.name)
    ).toEqual(['Unsubscribed contacts']);
    expect(client.applyOps.mock.calls[0][0].request.ops[0].table).toBe(
      'unsubscribe-table'
    );
    expect(cell(0, 'unsubscribe-table:Name')?.value).toBe('ada@example.com');
  });
  it('deletes a campaign and its enrollment rows in one write', async () => {
    client.read.mockImplementation(async (id: string) =>
      id === 'campaign-table'
        ? [{ rowId: 'campaign-row', data: JSON.stringify(campaign) }]
        : id === 'enrollment-table'
          ? [{ rowId: 'enrollment-row', data: JSON.stringify(enrollment) }]
          : []
    );
    const repository = createDatabaseMarketingRepository();
    await repository.load();
    client.applyOps.mockResolvedValue(ok({ changes: [], results: [] }));
    await repository.deleteCampaign('campaign', ['enrollment']);
    expect(client.applyOps).toHaveBeenCalledTimes(1);
    expect(client.applyOps.mock.calls[0][0].request.ops).toEqual([
      {
        kind: 'rows',
        table: 'enrollment-table',
        change: { kind: 'delete', rows: ['enrollment-row'] },
      },
      {
        kind: 'rows',
        table: 'campaign-table',
        change: { kind: 'delete', rows: ['campaign-row'] },
      },
    ]);
  });
  it('refuses a write that would exceed the request size limit before sending it', async () => {
    const repository = createDatabaseMarketingRepository();
    await repository.load();
    const huge: Enrollment = {
      ...enrollment,
      steps: Array.from({ length: 20 }, (_, index) => ({
        id: `step-${index}`,
        delayDays: 0,
        subject: 'Hi',
        body: '"'.repeat(49_000),
        sendAt: '2026-10-03T16:00:00Z',
        status: 'pending' as const,
      })),
    };
    await expect(repository.saveEnrollment(huge)).rejects.toMatchObject({
      code: 'sequenceTooLarge',
    });
    expect(client.applyOps).not.toHaveBeenCalled();
  });
});
