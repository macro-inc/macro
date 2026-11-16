import type { Catalog, Outcome } from '@core/database-sql/generated/types';
import type {
  CacheChangeListener,
  CacheGenerationChange,
} from '@graphql-cache/host/types';
import { parseCacheRevision } from '@graphql-cache/protocol';
import type { QueryAccount } from '@queries/auth/account-scope';
import { ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContactDirectoryScopeError } from '../contacts/cache-scope';
import {
  createDatabaseSqlQuery,
  type DatabaseSqlQueryCapabilities,
} from './create-database-sql-query';

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.restoreAllMocks();
});
const catalog: Catalog = {
  tables: [
    {
      id: 'people',
      databaseId: 'macro',
      database: 'macro',
      name: 'people',
      source: 'people',
      columns: [],
    },
  ],
};
const answer: Outcome = {
  columns: [{ name: 'name', kind: 'text' }],
  rows: [[{ type: 'text', value: 'Current' }]],
  readTables: ['people'],
  rowIds: [],
  truncated: false,
  changesApplied: 0,
  insertedRowIds: [],
};

function fixture() {
  const requests: {
    owner: QueryAccount;
    signal: AbortSignal;
    finish: (value: Outcome) => void;
    fail: (error: Error) => void;
  }[] = [];
  const [account, setAccount] = createSignal<QueryAccount>({
    userId: 'macro|viewer@example.com',
    session: 0,
  });
  const [sql, setSql] = createSignal('SELECT name FROM macro.people');
  const client = vi.fn((): never => {
    throw new Error('No GraphQL row source for a direct people statement');
  });
  const open = vi.fn(async (): Promise<never> => {
    throw new Error('No directory fold');
  });
  const changes = new Set<{
    callback: CacheChangeListener;
    hydration: boolean;
  }>();
  const generations = new Set<(change: CacheGenerationChange) => void>();
  let revision = 0;
  const host = {
    readQuery: vi.fn(),
    readRecordsByKeys: vi.fn(),
    entityFilter: vi.fn(),
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    onCacheGenerationChanged: (
      callback: (change: CacheGenerationChange) => void
    ) => {
      generations.add(callback);
      return () => {
        generations.delete(callback);
      };
    },
    onCacheChanged: (
      callback: CacheChangeListener,
      options?: { includeHydration?: boolean }
    ) => {
      const subscription = {
        callback,
        hydration: options?.includeHydration === true,
      };
      changes.add(subscription);
      return () => {
        changes.delete(subscription);
      };
    },
  };
  const capabilities: DatabaseSqlQueryCapabilities = {
    account,
    client,
    open,
    cacheHost: () => host,
    localPeople: () => host,
    catalog: async () => catalog,
    describe: async () => ({ columns: answer.columns, readTables: ['people'] }),
    localRead: (input, signal) => {
      const pending = Promise.withResolvers<Outcome>();
      requests.push({
        owner: input.account,
        signal,
        finish: pending.resolve,
        fail: pending.reject,
      });
      return pending.promise;
    },
  };
  const root = createRoot((dispose) => ({
    query: createDatabaseSqlQuery(
      () => ({ schema: { databases: [], platform: ['people'] }, sql: sql() }),
      capabilities
    ),
    dispose,
  }));
  return {
    ...root,
    requests,
    setAccount,
    setSql,
    client,
    open,
    host,
    changed: (hydration = false, buckets = ['person']) => {
      const value = parseCacheRevision(String(++revision));
      for (const entry of changes)
        if (!hydration || entry.hydration)
          entry.callback(value, { searchChangedBuckets: buckets });
    },
    reset: () => {
      for (const callback of generations) callback({ storage: 'reset' });
    },
  };
}

it('executes once locally, remains cache-readable, and never constructs a directory source', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    f.requests[0].finish(answer);
    await vi.waitFor(() => expect(f.query.outcome()).toEqual(answer));
    expect(f.query.cached()).toBe(true);
    expect(f.requests).toHaveLength(1);
    const cached = f.query.answerFromCache();
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    f.requests[1].finish(answer);
    expect(await cached).toEqual(ok({ landed: true }));
    expect(f.client).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  } finally {
    f.dispose();
  }
});

it.each([false, true])(
  'coalesces a committed/person hydration change behind an active local read (%s)',
  async (hydration) => {
    const f = fixture();
    try {
      await vi.waitFor(() => expect(f.requests).toHaveLength(1));
      f.changed(hydration);
      expect(f.requests[0].signal.aborted).toBe(false);
      f.requests[0].finish(answer);
      await vi.waitFor(() => expect(f.requests).toHaveLength(2));
      f.requests[1].finish({
        ...answer,
        rows: [[{ type: 'text', value: 'Updated' }]],
      });
      await vi.waitFor(() =>
        expect(f.query.outcome()?.rows).toEqual([
          [{ type: 'text', value: 'Updated' }],
        ])
      );
      expect(f.requests).toHaveLength(2);
    } finally {
      f.dispose();
    }
  }
);

it('refuses unsupported local capability without a remote or directory fallback', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    f.requests[0].fail(new Error('Local people SQL unavailable'));
    await vi.waitFor(() => expect(f.query.error()?.kind).toBe('rejected'));
    expect(f.query.outcome()).toBeUndefined();
    expect(f.client).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  } finally {
    f.dispose();
  }
});

it('clears authority failures before local identity refresh', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    f.requests[0].finish(answer);
    await vi.waitFor(() => expect(f.query.outcome()).toEqual(answer));
    const refreshed = f.query.refresh();
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    f.requests[1].fail(new ContactDirectoryScopeError());
    expect((await refreshed).isErr()).toBe(true);
    expect(f.query.outcome()).toBeUndefined();
    expect(f.query.catalog()).toBeUndefined();
  } finally {
    f.dispose();
  }
});

it('bounds physical work and rejects an old session even when the account returns', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    f.requests[0].finish(answer);
    await vi.waitFor(() => expect(f.query.outcome()).toEqual(answer));
    const old = f.query.refresh();
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    f.setAccount({ userId: 'macro|other@example.com', session: 1 });
    f.setAccount({ userId: 'macro|viewer@example.com', session: 2 });
    await vi.waitFor(() => expect(f.requests[1].signal.aborted).toBe(true));
    expect(f.requests).toHaveLength(2);
    expect(f.query.outcome()).toBeUndefined();
    f.requests[1].finish(answer);
    expect(await old).toEqual(ok({ landed: false }));
    await vi.waitFor(() => expect(f.requests).toHaveLength(3));
    expect(f.requests[2].owner.session).toBe(2);
    f.requests[2].finish({
      ...answer,
      rows: [[{ type: 'text', value: 'Replacement' }]],
    });
    await vi.waitFor(() =>
      expect(f.query.outcome()?.rows).toEqual([
        [{ type: 'text', value: 'Replacement' }],
      ])
    );
  } finally {
    f.dispose();
  }
});

it('returning to an earlier input never revives its pending operation', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    f.setSql('SELECT name FROM macro.people LIMIT 1');
    f.setSql('SELECT name FROM macro.people');
    await vi.waitFor(() => expect(f.requests[0].signal.aborted).toBe(true));
    expect(f.requests).toHaveLength(1);
    f.requests[0].finish(answer);
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    expect(f.query.outcome()).toBeUndefined();
    f.requests[1].finish({ ...answer, rows: [] });
    await vi.waitFor(() => expect(f.query.outcome()?.rows).toEqual([]));
  } finally {
    f.dispose();
  }
});

it('storage replacement clears results and obsolete physical replies', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    f.requests[0].finish(answer);
    await vi.waitFor(() => expect(f.query.outcome()).toEqual(answer));
    const old = f.query.refresh();
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    f.reset();
    expect(f.query.outcome()).toBeUndefined();
    f.requests[1].finish(answer);
    await old;
    await vi.waitFor(() => expect(f.requests).toHaveLength(3));
    f.requests[2].finish({ ...answer, rows: [] });
    await vi.waitFor(() => expect(f.query.outcome()?.rows).toEqual([]));
  } finally {
    f.dispose();
  }
});

it('cancels disposed reads and refuses detached refreshes under another session', async () => {
  const f = fixture();
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  f.dispose();
  expect(f.requests[0].signal.aborted).toBe(true);
  f.requests[0].finish(answer);
  f.setAccount({ userId: 'macro|viewer@example.com', session: 1 });
  expect(await f.query.refresh()).toEqual(ok({ landed: false }));
  expect(f.requests).toHaveLength(1);
  expect(f.query.outcome()).toBeUndefined();
});
