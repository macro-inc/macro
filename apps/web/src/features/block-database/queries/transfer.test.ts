import type { DatabaseTableDetail } from '@service-storage/databases';
import { describe, expect, it, vi } from 'vitest';
import { exportDatabaseTableCsv, importDatabaseTable } from './transfer';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  import: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@queries/storage/databases', () => ({
  querySql: mocks.query,
  invalidateDatabase: mocks.invalidate,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: { importTable: mocks.import } },
}));
const table = {
  table: { id: 'table', name: 'Contacts' },
  sql_name: 'contacts',
  read_sql_name: 'stable_contacts',
  columns: [
    {
      column: { id: 'name', display_name: 'Customer' },
      sql_name: 'name',
      definition: { definition: { display_name: 'Name' } },
    },
  ],
} as DatabaseTableDetail;
function outcome(
  rows: (string | number | null)[][],
  version = 1,
  truncated: string[] = []
) {
  return {
    results: [{ columns: [{ name: 'row_id' }, { name: 'name' }], rows }],
    read_versions: { table: version },
    truncated_tables: truncated,
  };
}

describe('CSV transfers', () => {
  it('exports user-facing headers, quotes values, and excludes internal row IDs', async () => {
    mocks.query.mockResolvedValueOnce(
      outcome([
        ['id-1', '00123'],
        ['id-2', 'a,b'],
      ])
    );
    const blob = await exportDatabaseTableCsv(table);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(text).toBe('Customer\n00123\n"a,b"');
    expect(mocks.query).toHaveBeenLastCalledWith(
      'SELECT * FROM "stable_contacts" ORDER BY "row_id" LIMIT 5000 OFFSET 0'
    );
  });
  it('refuses truncated data and schema mismatches instead of downloading partial CSV', async () => {
    mocks.query.mockResolvedValueOnce(outcome([], 1, ['contacts']));
    await expect(exportDatabaseTableCsv(table)).rejects.toThrow('too large');
    mocks.query.mockResolvedValueOnce({
      ...outcome([]),
      results: [{ columns: [{ name: 'renamed' }], rows: [] }],
    });
    await expect(exportDatabaseTableCsv(table)).rejects.toThrow(
      'columns changed'
    );
  });
  it('rejects an export that spans table versions', async () => {
    mocks.query
      .mockResolvedValueOnce(
        outcome(Array.from({ length: 5000 }, (_, i) => [`id-${i}`, 'Name']))
      )
      .mockResolvedValueOnce(outcome([['last', 'Name']], 2));
    await expect(exportDatabaseTableCsv(table)).rejects.toThrow(
      'table changed'
    );
  });
  it('retains the same import identity and reports validation errors', async () => {
    const request = {
      requestId: 'request',
      name: 'Contacts',
      columns: ['Name'],
      rows: [['Ada']],
    };
    mocks.import.mockResolvedValueOnce({
      isErr: () => true,
      error: [{ code: 'INVALID_SCHEMA', message: 'Choose another name.' }],
    });
    await expect(
      importDatabaseTable('database', request)
    ).rejects.toMatchObject({
      message: 'Choose another name.',
      code: 'INVALID_SCHEMA',
    });
    mocks.import.mockResolvedValueOnce({
      isErr: () => false,
      value: { id: 'imported' },
    });
    expect(await importDatabaseTable('database', request)).toEqual({
      id: 'imported',
    });
    expect(mocks.import).toHaveBeenLastCalledWith({ id: 'database', request });
    expect(mocks.invalidate).toHaveBeenCalledWith('database');
  });
});
