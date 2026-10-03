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
vi.mock('@service-storage/email-marketing', () => ({
  readMarketingTable: client.read,
}));
const campaign: Campaign = {
  id: 'campaign',
  name: 'Welcome',
  description: '',
  status: 'active',
  senderId: 'inbox',
  steps: [{ id: 'step', subject: 'Hello', body: 'Welcome', delayDays: 0 }],
  updatedAt: '2026-10-03T15:00:00Z',
};
function table(name: string, id: string, version: number) {
  return {
    table: { id, name, version },
    columns: [
      'Record ID',
      'Name',
      'Status',
      'Contact email',
      'Sequence data',
    ].map((name, index) => ({
      column: {
        id: `${id}-col-${index}`,
        property_definition_id: `${id}-prop-${index}`,
        display_name: name,
      },
      definition: { definition: { display_name: name } },
    })),
  };
}
const tables = [
  table('Email campaigns', 'campaign-table', 7),
  table('Sequence enrollments', 'enrollment-table', 12),
];
beforeEach(() => {
  vi.clearAllMocks();
  client.list.mockResolvedValue(
    ok([
      {
        database: { id: 'database', name: 'Email Marketing', trashed_at: null },
        tables: tables.map((table) => table.table),
      },
    ])
  );
  client.get.mockImplementation(async () =>
    ok({
      database: { id: 'database' },
      grant: 'owner',
      tables: structuredClone(tables),
    })
  );
  client.read.mockImplementation(async (id: string) =>
    id === 'campaign-table'
      ? [{ rowId: 'campaign-row', payload: campaign }]
      : []
  );
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
describe('Macro Databases sequence records', () => {
  it('protects enrollment against both campaign and enrollment version races and updates the same row handle', async () => {
    const repository = createDatabaseMarketingRepository();
    await repository.load();
    await repository.saveEnrollment(enrollment);
    const first = client.applyOps.mock.calls[0][0];
    expect(first.request.baseVersions).toEqual({
      'campaign-table': 7,
      'enrollment-table': 12,
    });
    const payload = first.request.ops[0].change.rows[0].find(
      (cell: { column: string }) => cell.column === 'enrollment-table-col-4'
    ).value;
    expect(payload.type).toBe('text');
    expect(JSON.parse(payload.value).contact.crmContactId).toBe('crm-contact');
    await repository.saveEnrollment({ ...enrollment, status: 'scheduled' });
    expect(
      client.applyOps.mock.calls[1][0].request.baseVersions['enrollment-table']
    ).toBe(13);
    expect(
      client.applyOps.mock.calls[1][0].request.ops[0].change.changes.rows
    ).toEqual(['enrollment-row']);
  });
  it('refuses malformed database records instead of treating existing enrollments as empty', async () => {
    client.read.mockResolvedValue([
      { rowId: 'broken', payload: { status: 'active' } },
    ]);
    await expect(createDatabaseMarketingRepository().load()).rejects.toThrow();
    expect(client.applyOps).not.toHaveBeenCalled();
  });
  it('preserves a server version conflict without retrying a duplicate insert', async () => {
    const repository = createDatabaseMarketingRepository();
    await repository.load();
    client.applyOps.mockResolvedValue(
      err([{ code: 'CONFLICT', message: 'Table changed', refusal: null }])
    );
    await expect(repository.saveEnrollment(enrollment)).rejects.toThrow();
    expect(client.applyOps).toHaveBeenCalledTimes(1);
  });
  it('does not allow writes through a shared read-only database', async () => {
    client.get.mockResolvedValue(
      ok({ grant: 'view', database: { id: 'database' }, tables })
    );
    const repository = createDatabaseMarketingRepository();
    expect((await repository.load()).writable).toBe(false);
    await expect(repository.saveCampaign(campaign)).rejects.toThrow(
      'edit access'
    );
    expect(client.applyOps).not.toHaveBeenCalled();
  });
});
