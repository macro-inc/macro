import type { DatabaseDetail } from '@service-storage/databases';
import { describe, expect, it, vi } from 'vitest';
import type { QueryAnswer } from '../core/query';
import { toQuerySchema } from './query-source';
import { createQuestionCapabilities } from './question-capabilities';

const detail: DatabaseDetail = {
  database: {
    id: 'support',
    name: 'Support',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'view',
  tables: ['Tickets', 'Customers'].map((name) => ({
    table: {
      id: name,
      database_id: 'support',
      name,
      position: name,
      version: 1,
    },
    sql_name: name.toLowerCase(),
    read_sql_name: `_macro_table_${name}`,
    columns: [],
  })),
};
const request = {
  prompt: 'Which customers have open tickets?',
  sql: '',
  schema: { name: 'Automatic', tables: [] },
};
const proposal = {
  databaseId: 'support',
  sql: 'SELECT COUNT(*) FROM "_macro_table_Tickets"',
  explanation: 'Counts tickets.',
};

describe('automatic question source verification', () => {
  const answer: QueryAnswer = {
    results: [],
    read_database_ids: ['support'],
    read_tables: ['Tickets'],
    read_versions: { Tickets: 1 },
    truncated_tables: [],
  };

  it('does not fetch the selected schema again before verifying the actual answer', async () => {
    const describe = vi.fn(async () => detail);
    const read = vi.fn(async () => answer);
    const capabilities = createQuestionCapabilities({
      generate: async () => proposal,
      describe,
      read,
    });
    const schema = toQuerySchema(detail);
    const generated = await capabilities.generate({ ...request, schema });
    expect(generated.source).toBe(schema);
    const verified = await capabilities.read(generated.sql, {
      databaseId: schema.databaseId,
      source: generated.source,
    });
    expect(verified.read_versions).toEqual({ Tickets: 1 });
    expect(read).toHaveBeenCalledExactlyOnceWith(generated.sql);
    expect(describe).not.toHaveBeenCalled();
  });

  it('rejects SQL that reads another database even when the model claims the chosen source', async () => {
    const capabilities = createQuestionCapabilities({
      generate: async () => proposal,
      describe: async () => detail,
      read: async () => answer,
    });
    await expect(
      capabilities.read('SELECT * FROM tickets', { databaseId: 'sales' })
    ).rejects.toThrow('reads another database');
  });

  it('resolves an automatic label from actual SQL dependencies instead of the claimed model source', async () => {
    const describe = vi.fn(async () => detail);
    const capabilities = createQuestionCapabilities({
      generate: async () => proposal,
      describe,
      read: async () => answer,
    });
    const result = await capabilities.read('SELECT * FROM tickets', {
      source: { databaseId: 'sales', name: 'Sales', tables: [] },
    });
    expect(result.source?.databaseId).toBe('support');
    expect(result.source?.tables.map((table) => table.id)).toContain(
      'Customers'
    );
    expect(describe).toHaveBeenCalledWith('support');
  });

  it('reuses a verified full schema, but refreshes it when the read contains a new table', async () => {
    const describe = vi.fn(async () => detail);
    const capabilities = createQuestionCapabilities({
      generate: async () => proposal,
      describe,
      read: async () => answer,
    });
    const source = toQuerySchema(detail);
    const result = await capabilities.read('SELECT * FROM tickets', {
      databaseId: 'support',
      source,
    });
    expect(result.source).toBe(source);
    expect(describe).not.toHaveBeenCalled();
    await capabilities.read('SELECT * FROM tickets', {
      databaseId: 'support',
      source: { ...source, tables: [] },
    });
    expect(describe).toHaveBeenCalledWith('support');
  });

  it('rejects read table IDs that do not belong to the verified source', async () => {
    const capabilities = createQuestionCapabilities({
      generate: async () => proposal,
      describe: async () => detail,
      read: async () => ({ ...answer, read_tables: ['unknown'] }),
    });
    await expect(
      capabilities.read('SELECT * FROM unknown', { databaseId: 'support' })
    ).rejects.toThrow('source tables could not be verified');
  });

  it('allows platform reads and clears an automatic source claim when no user database was read', async () => {
    const describe = vi.fn();
    const capabilities = createQuestionCapabilities({
      generate: async () => proposal,
      describe,
      read: async () => ({ ...answer, read_database_ids: [], read_tables: [] }),
    });
    const result = await capabilities.read('SELECT * FROM people', {
      source: toQuerySchema(detail),
    });
    expect(result.source?.databaseId).toBeUndefined();
    await expect(
      capabilities.read('SELECT * FROM people', { databaseId: 'support' })
    ).resolves.toBeDefined();
    expect(describe).not.toHaveBeenCalled();
  });

  it('discovers without a chosen source and verifies access to the entire resolved database', async () => {
    const describe = vi.fn(async () => detail);
    const generate = vi.fn(async () => proposal);
    const capabilities = createQuestionCapabilities({
      generate,
      describe,
      read: vi.fn(),
    });
    const result = await capabilities.generate(request);
    expect(generate).toHaveBeenCalledWith(request);
    expect(describe).toHaveBeenCalledWith('support');
    expect(result.source).toMatchObject({
      databaseId: 'support',
      name: 'Support',
    });
    expect(result.source?.focusTableId).toBeUndefined();
    expect(result.source?.tables.map((table) => table.name)).toContain(
      'Tickets'
    );
    expect(result.source?.tables.map((table) => table.name)).toContain(
      'Customers'
    );
    expect(result.source?.tables[0].sqlName).toBe('_macro_table_Tickets');
  });

  it('rejects an inaccessible or unverified model-selected source', async () => {
    const describe = vi.fn().mockRejectedValueOnce(new Error('Access denied'));
    const capabilities = createQuestionCapabilities({
      generate: async () => proposal,
      describe,
      read: vi.fn(),
    });
    await expect(capabilities.generate(request)).rejects.toThrow(
      'Access denied'
    );
    describe.mockResolvedValueOnce({
      ...detail,
      database: { ...detail.database, id: 'another' },
    });
    await expect(capabilities.generate(request)).rejects.toThrow(
      'could not be verified'
    );
  });

  it('preserves explicit database scope instead of silently replacing it', async () => {
    const describe = vi.fn();
    const capabilities = createQuestionCapabilities({
      generate: async () => proposal,
      describe,
      read: vi.fn(),
    });
    await expect(
      capabilities.generate({
        ...request,
        schema: { ...request.schema, databaseId: 'sales' },
      })
    ).rejects.toThrow('Choose Automatic');
    expect(describe).not.toHaveBeenCalled();
  });

  it('permits platform-only questions without inventing a source database', async () => {
    const describe = vi.fn();
    const capabilities = createQuestionCapabilities({
      generate: async () => ({
        sql: 'SELECT name FROM people',
        explanation: 'Team members.',
      }),
      describe,
      read: vi.fn(),
    });
    const result = await capabilities.generate(request);
    expect(result.source).toBeUndefined();
    expect(describe).not.toHaveBeenCalled();
  });
});
