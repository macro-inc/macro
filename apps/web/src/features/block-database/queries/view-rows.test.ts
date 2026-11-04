import type { Catalog, DatabaseView } from '@core/database-sql/generated/types';
import type {
  DatabaseViewPage,
  DatabaseViewPageFailure,
  DatabaseViewPageRequest,
} from '@service-storage/database-view-rows';
import { waitFor } from '@solidjs/testing-library';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseViewQuery } from './view-rows';

const view: DatabaseView = {
  id: 'view',
  databaseId: 'database',
  tableId: 'table',
  name: 'All records',
  position: '80',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  query: { filter: null, sort: [] },
  layout: { kind: 'table', columns: [] },
};
const catalog: Catalog = {
  tables: [
    {
      id: 'table',
      databaseId: 'database',
      database: 'Database',
      name: 'Records',
      source: 'database',
      columns: [
        {
          id: 'name',
          placement: 'name-column',
          name: 'Name',
          kind: { kind: 'text' },
        },
      ],
    },
  ],
};

function page(
  ids: string[],
  nextCursor: string | null = null,
  version = 1
): DatabaseViewPage {
  return {
    nextCursor,
    version,
    items: ids.map((id) => ({
      __typename: 'GraphqlSoupDatabaseRow',
      id,
      tableId: 'table',
      position: id,
      ownerId: 'macro|viewer@example.com',
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      cacheProjection: null,
      notifications: [],
      properties: [
        {
          id: `${id}-name`,
          propertyDefinitionId: 'name',
          value: { __typename: 'GraphqlStringPropertyValue', stringValue: id },
        },
      ],
    })),
  };
}

const disposals: (() => void)[] = [];
afterEach(() => disposals.splice(0).forEach((dispose) => dispose()));

function harness(
  read: (
    request: DatabaseViewPageRequest
  ) => ResultAsync<DatabaseViewPage, DatabaseViewPageFailure>
) {
  return createRoot((dispose) => {
    disposals.push(dispose);
    const [current, setCurrent] = createSignal(view);
    const readPage = vi.fn((request: DatabaseViewPageRequest) => read(request));
    const query = createDatabaseViewQuery(
      () => ({ schema: { databases: [], platform: [] }, view: current() }),
      { readPage, catalog: async () => catalog }
    );
    return { query, readPage, setCurrent, dispose };
  });
}

const uncached = () =>
  errAsync<DatabaseViewPage, DatabaseViewPageFailure>({
    kind: 'fetch',
    message: 'Not cached',
  });

describe('server view pages', () => {
  it('keeps loaded pages when only the view name or column layout changes', async () => {
    const { query, readPage, setCurrent } = harness((request) =>
      request.requestPolicy === 'cache-only'
        ? uncached()
        : okAsync(page(['a'], 'next'))
    );
    await waitFor(() => expect(query.outcome()?.rowIds).toEqual(['a']));
    setCurrent({
      ...view,
      name: 'Renamed view',
      updatedAt: '2026-02-01T00:00:00Z',
      layout: {
        kind: 'table',
        columns: [{ column: 'name-column', width: 300 }],
      },
    });
    await Promise.resolve();
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(query.pagination?.hasMore()).toBe(true);
  });
  it('opens with one page and fetches the continuation only on demand', async () => {
    const { query, readPage } = harness((request) =>
      request.requestPolicy === 'cache-only'
        ? uncached()
        : okAsync(
            request.cursor ? page(['c', 'd']) : page(['a', 'b'], 'after-b')
          )
    );
    await waitFor(() => expect(query.outcome()?.rowIds).toEqual(['a', 'b']));
    expect(
      readPage.mock.calls.map(([request]) => [
        request.requestPolicy,
        request.cursor,
      ])
    ).toEqual([['cache-and-network', undefined]]);
    expect(query.pagination?.hasMore()).toBe(true);
    const firstCells = query.outcome()?.rows[0];
    await query.pagination?.loadMore();
    expect(query.outcome()?.rowIds).toEqual(['a', 'b', 'c', 'd']);
    expect(query.outcome()?.rows[0]).toBe(firstCells);
    expect(query.outcome()?.rows).toEqual(
      ['a', 'b', 'c', 'd'].map((value) => [{ type: 'text', value }])
    );
    expect(query.pagination?.hasMore()).toBe(false);
    await query.pagination?.loadMore();
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('shows the cached first page while the current server page is pending', async () => {
    let resolve!: (page: DatabaseViewPage) => void;
    const pending = new Promise<DatabaseViewPage>((done) => {
      resolve = done;
    });
    const { query } = harness((request) => {
      request.onCachedPage?.(page(['cached'], 'cached-next'));
      return ResultAsync.fromSafePromise(pending);
    });
    await waitFor(() => expect(query.outcome()?.rowIds).toEqual(['cached']));
    expect(query.loading()).toBe(true);
    resolve(page(['fresh']));
    await waitFor(() => expect(query.outcome()?.rowIds).toEqual(['fresh']));
    expect(query.loading()).toBe(false);
  });

  it('keeps a delayed cache hit when the network fails first', async () => {
    let resolve!: (page: DatabaseViewPage) => void;
    const pending = new Promise<DatabaseViewPage>((done) => {
      resolve = done;
    });
    const { query, readPage } = harness((request) =>
      request.requestPolicy === 'cache-only'
        ? ResultAsync.fromSafePromise(pending)
        : errAsync({ kind: 'fetch', message: 'Offline' })
    );
    await waitFor(() => expect(readPage).toHaveBeenCalledTimes(2));
    resolve(page(['cached']));
    await waitFor(() => expect(query.outcome()?.rowIds).toEqual(['cached']));
    expect(query.error()).toEqual({ kind: 'fetch', message: 'Offline' });
    expect(query.loading()).toBe(false);
  });

  it('restarts a stale continuation without appending rows from two versions', async () => {
    let calls = 0;
    const { query } = harness((request) => {
      if (request.requestPolicy === 'cache-only') return uncached();
      calls += 1;
      if (calls === 1) return okAsync(page(['old'], 'old-next'));
      if (calls === 2)
        return errAsync({ kind: 'fetch', message: 'Changed', stale: true });
      return okAsync(
        request.cursor
          ? page(['new-b'], null, 2)
          : page(['new-a'], 'new-next', 2)
      );
    });
    await waitFor(() => expect(query.outcome()?.rowIds).toEqual(['old']));
    await query.pagination?.loadMore();
    expect(query.outcome()?.rowIds).toEqual(['new-a', 'new-b']);
    expect(query.pagination?.version()).toBe(2);
    expect(query.pagination?.hasMore()).toBe(false);
    expect(query.error()).toBeUndefined();
  });

  it('ignores an old view response that arrives after a newer filter', async () => {
    let resolve!: (page: DatabaseViewPage) => void;
    const pending = new Promise<DatabaseViewPage>((done) => {
      resolve = done;
    });
    const { query, readPage, setCurrent } = harness((request) =>
      request.requestPolicy === 'cache-only'
        ? uncached()
        : request.query.sort?.length
          ? okAsync(page(['sorted']))
          : ResultAsync.fromSafePromise(pending)
    );
    await waitFor(() => expect(readPage).toHaveBeenCalledTimes(1));
    setCurrent({
      ...view,
      query: {
        filter: null,
        sort: [{ column: 'name-column', direction: 'descending' }],
      },
    });
    await waitFor(() => expect(query.outcome()?.rowIds).toEqual(['sorted']));
    resolve(page(['late']));
    await Promise.resolve();
    expect(query.outcome()?.rowIds).toEqual(['sorted']);
  });

  it('still completes an explicit read after its owner closes, for an accepted write', async () => {
    let value = 'before';
    const { query, dispose } = harness((request) =>
      request.requestPolicy === 'cache-only'
        ? uncached()
        : okAsync(page([value]))
    );
    await waitFor(() => expect(query.outcome()?.rowIds).toEqual(['before']));
    dispose();
    value = 'saved';
    const result = await query.refresh('after-write');
    expect(result.isOk() && result.value.landed).toBe(true);
    expect(query.outcome()?.rowIds).toEqual(['saved']);
  });
});
