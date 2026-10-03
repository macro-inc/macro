import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { checkReadStatement, runDatabaseSql } from './driver';
import type { Bin, GqlQuery, Page } from './generated/types';
import { readTranscript, replay } from './tests/transcript';

describe('runDatabaseSql', () => {
  it('asks the source for each page the engine wants, following the cursor', async () => {
    const paging = readTranscript('paging');
    const page = vi.fn(
      (
        _query: GqlQuery,
        _needs: string[],
        cursor: string | null,
        _limit: number
      ) => {
        const exchange = paging.exchanges[cursor === null ? 0 : 1];
        if (!('page' in exchange)) throw new Error('recorded bins');
        return okAsync<Page>(exchange.page);
      }
    );

    const outcome = await runDatabaseSql(paging.catalog, paging.sql, {
      source: { page, bins: vi.fn() },
      open: replay(paging),
    });

    expect(outcome._unsafeUnwrap()).toEqual(paging.outcome);
    expect(page.mock.calls).toEqual([
      [
        {
          type: 'soup',
          table: '01990000-0000-7000-8000-00000000d001',
          propf: null,
          keyHint: null,
        },
        ['01990000-0000-7000-8000-00000000c001'],
        null,
        500,
        expect.any(Object),
      ],
      [
        {
          type: 'soup',
          table: '01990000-0000-7000-8000-00000000d001',
          propf: null,
          keyHint: null,
        },
        ['01990000-0000-7000-8000-00000000c001'],
        'second-page',
        500,
        expect.any(Object),
      ],
    ]);
  });

  it('answers a grouped count from the bins alone', async () => {
    const counts = readTranscript('count-per-option');
    const bins = vi.fn(() => {
      const exchange = counts.exchanges[0];
      if (!('bins' in exchange)) throw new Error('recorded a page');
      return okAsync<Bin[]>(exchange.bins);
    });
    const page = vi.fn();

    const outcome = await runDatabaseSql(counts.catalog, counts.sql, {
      source: { page, bins },
      open: replay(counts),
    });

    expect(outcome._unsafeUnwrap()).toEqual(counts.outcome);
    expect(bins.mock.calls).toEqual([
      [
        {
          type: 'groupSoup',
          table: '01990000-0000-7000-8000-00000000d001',
          propf: null,
          groupBy: '01990000-0000-7000-8000-00000000c003',
        },
        expect.any(Object),
      ],
    ]);
    expect(page).not.toHaveBeenCalled();
  });

  it('reports a statement the engine refuses as an engine failure, freeing nothing it never opened', async () => {
    const outcome = await runDatabaseSql(
      { tables: [] },
      'SELECT name FROM crm.deals',
      {
        source: { page: vi.fn(), bins: vi.fn() },
        open: async () => {
          throw {
            error: {
              stage: 'resolve',
              kind: 'unknownTable',
              name: 'crm.deals',
              suggestion: null,
            },
            message: 'unknown table crm.deals',
          };
        },
      }
    );

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'engine',
      error: {
        stage: 'resolve',
        kind: 'unknownTable',
        name: 'crm.deals',
        suggestion: null,
      },
      message: 'unknown table crm.deals',
    });
  });

  it('reports anything else thrown while opening the engine as a crash', async () => {
    const outcome = await runDatabaseSql({ tables: [] }, 'SELECT 1', {
      source: { page: vi.fn(), bins: vi.fn() },
      open: async () => {
        throw new TypeError('buildCatalog is not a function');
      },
    });

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'crash',
      message: 'buildCatalog is not a function',
    });
  });

  it('frees the engine when the source fails', async () => {
    const paging = readTranscript('paging');
    const free = vi.fn();
    const open = replay(paging);

    const outcome = await runDatabaseSql(paging.catalog, paging.sql, {
      source: {
        page: () =>
          errAsync({ kind: 'fetch' as const, message: 'gateway timed out' }),
        bins: vi.fn(),
      },
      open: async (catalog, sql) => ({ ...(await open(catalog, sql)), free }),
    });

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'fetch',
      message: 'gateway timed out',
    });
    expect(free).toHaveBeenCalledTimes(1);
  });

  it('refuses a write where only reads run, sending nothing', async () => {
    const insert = readTranscript('insert-two-rows');

    const outcome = await runDatabaseSql(insert.catalog, insert.sql, {
      source: { page: vi.fn(), bins: vi.fn() },
      open: replay(insert),
    });

    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'read-only' });
  });
});

describe('checkReadStatement', () => {
  it('accepts a read the engine compiles, without reading a row', async () => {
    const free = vi.fn();
    const checked = await checkReadStatement(
      { tables: [] },
      'SELECT name FROM crm.deals',
      {
        open: async () => ({
          start: () => ({
            step: 'fetch',
            id: 0,
            query: { type: 'soup', table: 'deals', propf: null, keyHint: null },
            needs: ['name'],
            cursor: null,
            limit: 500,
          }),
          feed_page: (_id, page) => ({
            step: 'done',
            columns: [{ name: 'name', column: 'name', kind: 'text' }],
            rows: page.rows.map(() => []),
            rowIds: [],
            readTables: ['deals'],
            truncated: false,
            insertedRowIds: [],
            changesApplied: 0,
          }),
          feed_bins: vi.fn(),
          free,
        }),
      }
    );

    expect(checked.isOk()).toBe(true);
    expect(free).toHaveBeenCalledTimes(1);
  });

  it('refuses a statement that writes', async () => {
    const insert = readTranscript('insert-two-rows');

    const checked = await checkReadStatement(insert.catalog, insert.sql, {
      open: replay(insert),
    });

    expect(checked._unsafeUnwrapErr()).toEqual({ kind: 'read-only' });
  });

  it('refuses a write that matched no rows, which answers without columns', async () => {
    const checked = await checkReadStatement(
      { tables: [] },
      "UPDATE crm.deals SET stage = 'Won' WHERE name = 'Acme'",
      {
        open: async () => ({
          start: () => ({
            step: 'done',
            columns: [],
            rows: [],
            rowIds: [],
            readTables: ['deals'],
            truncated: false,
            insertedRowIds: [],
            changesApplied: 0,
          }),
          feed_page: vi.fn(),
          feed_bins: vi.fn(),
          free: vi.fn(),
        }),
      }
    );

    expect(checked._unsafeUnwrapErr()).toEqual({ kind: 'read-only' });
  });

  it('reports what the engine does not compile', async () => {
    const checked = await checkReadStatement({ tables: [] }, 'SELEC 1', {
      open: async () => {
        throw {
          error: {
            stage: 'parse',
            span: { start: 0, end: 5 },
            message: 'expected a statement, found "SELEC"',
          },
          message: 'expected a statement, found "SELEC"',
        };
      },
    });

    expect(checked._unsafeUnwrapErr()).toEqual({
      kind: 'engine',
      error: {
        stage: 'parse',
        span: { start: 0, end: 5 },
        message: 'expected a statement, found "SELEC"',
      },
      message: 'expected a statement, found "SELEC"',
    });
  });
});
