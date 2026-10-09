import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseApi } from '../core/api';
import { readDatabasePages } from './api-source';

const request = { tableId: 'table', query: { filter: null } };
function api(readRows: DatabaseApi['readRows']): DatabaseApi {
  return {
    key: ['test'],
    readRows,
    readTable: () => errAsync({ kind: 'table-unavailable' }),
    applyOps: () => okAsync({ results: [] }),
  };
}

describe('API row pagination', () => {
  it('restarts the complete read when versions differ, preserving the query', async () => {
    const read = vi
      .fn<DatabaseApi['readRows']>()
      .mockReturnValueOnce(
        okAsync({
          rows: [{ rowId: 'old', cells: {} }],
          tableVersion: 1,
          nextCursor: 'next',
        })
      )
      .mockReturnValueOnce(okAsync({ rows: [], tableVersion: 2 }))
      .mockReturnValueOnce(
        okAsync({
          rows: [{ rowId: 'new', cells: {} }],
          tableVersion: 2,
          nextCursor: 'next',
        })
      )
      .mockReturnValueOnce(
        okAsync({ rows: [{ rowId: 'last', cells: {} }], tableVersion: 2 })
      );
    const result = await readDatabasePages(api(read), request);
    expect(result._unsafeUnwrap()).toEqual({
      rows: [
        { rowId: 'new', cells: {} },
        { rowId: 'last', cells: {} },
      ],
      version: 2,
    });
    expect(read.mock.calls.map(([args]) => args.cursor)).toEqual([
      undefined,
      'next',
      undefined,
      'next',
    ]);
    expect(
      read.mock.calls.every(([args]) => args.query === request.query)
    ).toBe(true);
  });
  it('refuses a repeated cursor instead of looping forever', async () => {
    const read = vi.fn<DatabaseApi['readRows']>(() =>
      okAsync({ rows: [], tableVersion: 1, nextCursor: 'same' })
    );
    expect((await readDatabasePages(api(read), request)).isErr()).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('preserves retained-row requests across pages and returns read failures', async () => {
    const read = vi.fn<DatabaseApi['readRows']>(() =>
      errAsync({ kind: 'fetch', message: 'offline' })
    );
    expect(
      (
        await readDatabasePages(api(read), { ...request, rowIds: ['held'] })
      ).isErr()
    ).toBe(true);
    expect(read).toHaveBeenCalledWith({
      ...request,
      rowIds: ['held'],
      cursor: undefined,
    });
  });
});
