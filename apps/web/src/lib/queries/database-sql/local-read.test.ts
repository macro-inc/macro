import type { ReadDescription } from '@core/database-sql/generated/types';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { PeopleSqlResult } from '@graphql-cache/people/generated';
import type { PeopleCache } from '@graphql-cache/people/host';
import { createPeopleCache } from '@graphql-cache/people/host';
import { beforeEach, expect, it, vi } from 'vitest';
import { createLocalSqlReader, type LocalSqlInput } from './local-read';

const checkpoint = vi.hoisted(() => vi.fn());
vi.mock('../contacts/backfill', () => ({ loadContactCheckpoint: checkpoint }));
const VIEWER = 'macro|viewer@example.com';
const GENERATION = '00000000-0000-4000-8000-000000000001';
const TABLE = '6d616372-6f00-0000-0000-000070656f70';
const DESCRIPTION: ReadDescription = {
  readTables: [TABLE],
  columns: [{ name: 'total', kind: 'number' }],
};
const RESULT: PeopleSqlResult = {
  kind: 'result',
  outcome: {
    ...DESCRIPTION,
    rows: [[{ type: 'number', value: 100001 }]],
    rowIds: [],
    insertedRowIds: [],
    changesApplied: 0,
    truncated: false,
  },
};
function fixture() {
  const read = vi.fn<PeopleCache['readSql']>().mockResolvedValue(RESULT);
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    readQuery: vi.fn(async () => ({
      kind: 'hit' as const,
      data: { user: { id: VIEWER } },
    })),
    currentStorageGeneration: vi.fn(async () => GENERATION),
    people: createPeopleCache({
      readSql: read,
      context: async () => ({ kind: 'unsupported' }),
      update: async () => '0',
      search: async () => ({ kind: 'unsupported' }),
      resolveReferences: async () => ({ kind: 'unsupported' }),
    }),
  };
  const input: LocalSqlInput = {
    account: { userId: VIEWER, session: 1 },
    host,
    input: {
      kind: 'statement',
      sql: 'SELECT COUNT(*) AS total FROM macro.people',
    },
    description: DESCRIPTION,
  };
  return {
    read,
    host,
    input,
    reader: createLocalSqlReader(),
    signal: new AbortController().signal,
  };
}
beforeEach(() => {
  checkpoint.mockReset().mockReturnValue({ completedAt: 1 });
});

it('reads a complete scoped local snapshot without a server transport', async () => {
  const f = fixture();
  const result = await f.reader.read(f.input, f.signal);
  expect(result._unsafeUnwrap()).toEqual(RESULT.outcome);
  expect(f.read.mock.calls[0][0]).toEqual({
    scope: { identity: VIEWER, storageGeneration: GENERATION },
    input: f.input.input,
  });
  expect(f.host.currentStorageGeneration).toHaveBeenCalledTimes(2);
  f.reader.dispose();
});

it('never makes an incomplete cached count authoritative retroactively', async () => {
  const f = fixture();
  checkpoint.mockReturnValue({ completedAt: null });
  expect((await f.reader.read(f.input, f.signal))._unsafeUnwrapErr().kind).toBe(
    'rejected'
  );
  expect(f.read).not.toHaveBeenCalled();
  checkpoint.mockReturnValue({ completedAt: 1 });
  expect((await f.reader.read(f.input, f.signal)).isOk()).toBe(true);
  f.reader.dispose();
});

it('refuses a scope change after an otherwise valid native reply', async () => {
  const f = fixture();
  f.host.currentStorageGeneration
    .mockResolvedValueOnce(GENERATION)
    .mockResolvedValue('00000000-0000-4000-8000-000000000002');
  expect((await f.reader.read(f.input, f.signal))._unsafeUnwrapErr().kind).toBe(
    'scope-changed'
  );
  f.reader.dispose();
});

it.each(['unsupported', 'incomplete', 'resultTooLarge'] as const)(
  'keeps %s explicit rather than returning an empty table',
  async (kind) => {
    const f = fixture();
    f.read.mockResolvedValue({ kind });
    expect(
      (await f.reader.read(f.input, f.signal))._unsafeUnwrapErr().kind
    ).toBe('rejected');
    expect(f.read).toHaveBeenCalledOnce();
    f.reader.dispose();
  }
);

it('checks compiler-bound metadata and synchronization after the operation', async () => {
  const f = fixture();
  f.input.description = {
    ...DESCRIPTION,
    columns: [{ name: 'different', kind: 'number' }],
  };
  expect((await f.reader.read(f.input, f.signal))._unsafeUnwrapErr().kind).toBe(
    'rejected'
  );
  f.input.description = DESCRIPTION;
  checkpoint
    .mockReturnValueOnce({ completedAt: 1 })
    .mockReturnValue({ completedAt: null });
  expect((await f.reader.read(f.input, f.signal))._unsafeUnwrapErr().kind).toBe(
    'rejected'
  );
  f.reader.dispose();
});
