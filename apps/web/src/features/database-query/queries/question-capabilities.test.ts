import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { QueryCapabilities } from '../context/query-context';
import type { QueryAnswer, QueryFailure, QueryProposal } from '../core/query';
import { toQuerySchema } from './query-source';
import { createQuestionCapabilities } from './question-capabilities';

type Describe = (
  databaseId: string
) => ResultAsync<DatabaseDetail, QueryFailure>;

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
    views: [],
    table: {
      id: name,
      database_id: 'support',
      name,
      position: name,
      version: 1,
    },
    sql_name: `"${name}"`,
    columns: [],
  })),
};
const request = {
  prompt: 'Which customers have open tickets?',
  sql: '',
  schema: { name: 'Automatic', tables: [] },
};
const proposal: QueryProposal = {
  databaseId: 'support',
  sql: 'SELECT COUNT(*) FROM "Tickets"',
  explanation: 'Counts tickets.',
};

describe('automatic question source verification', () => {
  const answer: QueryAnswer = {
    columns: [{ name: 'Count', kind: 'number' }],
    rows: [[{ type: 'number', value: 1 }]],
    rowIds: [],
    readTables: ['Tickets'],
    readDatabaseIds: ['support'],
    truncatedTables: [],
  };

  it('does not fetch the selected schema again before verifying the actual answer', async () => {
    const describe = vi.fn<Describe>(() => okAsync(detail));
    const read = vi.fn<QueryCapabilities['read']>(() => okAsync(answer));
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe,
      read,
    });
    const schema = toQuerySchema(detail);
    const generated = (
      await capabilities.generate({ ...request, schema })
    )._unsafeUnwrap();
    expect(generated.source).toBe(schema);
    const verified = (
      await capabilities.read(generated.sql, {
        databaseId: schema.databaseId,
        source: generated.source,
      })
    )._unsafeUnwrap();
    expect(verified).toEqual({ ...answer, source: schema });
    expect(read).toHaveBeenCalledExactlyOnceWith(generated.sql, {
      databaseId: schema.databaseId,
      source: generated.source,
    });
    expect(describe).not.toHaveBeenCalled();
  });

  it('rejects SQL that reads another database even when the model claims the chosen source', async () => {
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe: () => okAsync(detail),
      read: () => okAsync(answer),
    });
    const result = await capabilities.read('SELECT * FROM tickets', {
      databaseId: 'sales',
    });
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'other-database' });
  });

  it('resolves an automatic label from actual SQL dependencies instead of the claimed model source', async () => {
    const describe = vi.fn<Describe>(() => okAsync(detail));
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe,
      read: () => okAsync(answer),
    });
    const result = (
      await capabilities.read('SELECT * FROM tickets', {
        source: { databaseId: 'sales', name: 'Sales', tables: [] },
      })
    )._unsafeUnwrap();
    expect(result.source?.databaseId).toBe('support');
    expect(result.source?.tables.map((table) => table.id)).toContain(
      'Customers'
    );
    expect(describe).toHaveBeenCalledWith('support');
  });

  it('reuses a verified full schema, but refreshes it when the read contains a new table', async () => {
    const describe = vi.fn<Describe>(() => okAsync(detail));
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe,
      read: () => okAsync(answer),
    });
    const source = toQuerySchema(detail);
    const result = (
      await capabilities.read('SELECT * FROM tickets', {
        databaseId: 'support',
        source,
      })
    )._unsafeUnwrap();
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
      generate: () => okAsync(proposal),
      describe: () => okAsync(detail),
      read: () => okAsync({ ...answer, readTables: ['unknown'] }),
    });
    const result = await capabilities.read('SELECT * FROM unknown', {
      databaseId: 'support',
    });
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'unverified-source' });
  });

  it('allows platform reads and clears an automatic source claim when no user database was read', async () => {
    const describe = vi.fn<Describe>(() => okAsync(detail));
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe,
      read: () => okAsync({ ...answer, readDatabaseIds: [], readTables: [] }),
    });
    const result = (
      await capabilities.read('SELECT * FROM people', {
        source: toQuerySchema(detail),
      })
    )._unsafeUnwrap();
    expect(result.source?.databaseId).toBeUndefined();
    const scoped = await capabilities.read('SELECT * FROM people', {
      databaseId: 'support',
    });
    expect(scoped.isOk()).toBe(true);
    expect(describe).not.toHaveBeenCalled();
  });

  it('refuses an answer over several databases that names none of them', async () => {
    const describe = vi.fn<Describe>(() => okAsync(detail));
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe,
      read: () =>
        okAsync({
          columns: [{ name: 'Count', kind: 'number' }],
          rows: [[{ type: 'number', value: 1 }]],
          rowIds: [],
          readTables: ['Tickets', 'Deals'],
          readDatabaseIds: ['support', 'sales'],
          truncatedTables: [],
        }),
    });
    const result = await capabilities.read(
      'SELECT COUNT(*) FROM support.Tickets JOIN sales.Deals ON Tickets.deal = Deals.row_id'
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'ambiguous-source' });
    expect(describe).not.toHaveBeenCalled();
  });

  it('leaves an automatic answer that reads no database without a source', async () => {
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe: vi.fn<Describe>(),
      read: () =>
        okAsync({
          columns: [{ name: 'name', kind: 'text' }],
          rows: [[{ type: 'text', value: 'Ada' }]],
          rowIds: [],
          readTables: [],
          readDatabaseIds: [],
          truncatedTables: [],
        }),
    });
    const result = await capabilities.read('SELECT name FROM macro.people');
    expect(result._unsafeUnwrap()).toEqual({
      columns: [{ name: 'name', kind: 'text' }],
      rows: [[{ type: 'text', value: 'Ada' }]],
      rowIds: [],
      readTables: [],
      readDatabaseIds: [],
      truncatedTables: [],
    });
  });

  it('discovers without a chosen source and verifies access to the entire resolved database', async () => {
    const describe = vi.fn<Describe>(() => okAsync(detail));
    const generate = vi.fn<QueryCapabilities['generate']>(() =>
      okAsync(proposal)
    );
    const capabilities = createQuestionCapabilities({
      generate,
      describe,
      read: vi.fn<QueryCapabilities['read']>(),
    });
    const result = (await capabilities.generate(request))._unsafeUnwrap();
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
    expect(result.source?.tables[0].sqlName).toBe('"Tickets"');
  });

  it('rejects an inaccessible or unverified model-selected source', async () => {
    const denied: QueryFailure = {
      kind: 'databases',
      error: { code: 'FORBIDDEN', message: 'Access denied' },
    };
    const describe = vi
      .fn<Describe>(() => okAsync(detail))
      .mockReturnValueOnce(errAsync(denied));
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe,
      read: vi.fn<QueryCapabilities['read']>(),
    });
    expect((await capabilities.generate(request))._unsafeUnwrapErr()).toEqual(
      denied
    );
    describe.mockReturnValueOnce(
      okAsync({ ...detail, database: { ...detail.database, id: 'another' } })
    );
    expect((await capabilities.generate(request))._unsafeUnwrapErr()).toEqual({
      kind: 'unverified-source',
    });
  });

  it('preserves explicit database scope instead of silently replacing it', async () => {
    const describe = vi.fn<Describe>(() => okAsync(detail));
    const capabilities = createQuestionCapabilities({
      generate: () => okAsync(proposal),
      describe,
      read: vi.fn<QueryCapabilities['read']>(),
    });
    const result = await capabilities.generate({
      ...request,
      schema: { ...request.schema, databaseId: 'sales' },
    });
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'other-database' });
    expect(describe).not.toHaveBeenCalled();
  });

  it('permits platform-only questions without inventing a source database', async () => {
    const describe = vi.fn<Describe>(() => okAsync(detail));
    const capabilities = createQuestionCapabilities({
      generate: () =>
        okAsync({
          sql: 'SELECT name FROM people',
          explanation: 'Team members.',
        }),
      describe,
      read: vi.fn<QueryCapabilities['read']>(),
    });
    const result = (await capabilities.generate(request))._unsafeUnwrap();
    expect(result.source).toBeUndefined();
    expect(describe).not.toHaveBeenCalled();
  });
});
