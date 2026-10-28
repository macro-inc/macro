import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { refreshChangedRows } from './table-changes';

describe('an incremental table refresh', () => {
  it('reads the changed rows into the cache, drops the removed ones and answers from the cache, without a full read', async () => {
    const read: string[][] = [];
    const forgotten: string[][] = [];
    const answered: number[] = [];
    let fullReads = 0;
    const written = Array.from({ length: 120 }, (_, index) => `row-${index}`);

    const reached = await refreshChangedRows({
      from: 4,
      version: 6,
      changes: {
        since: (version) =>
          okAsync({
            version: 6,
            complete: version === 4,
            truncated: false,
            rows: [
              ...written.map((row) => ({ row, kind: 'update' as const })),
              { row: 'omar', kind: 'delete' as const },
            ],
            columns: [],
          }),
        readRows: (rowIds) => {
          read.push(rowIds);
          return okAsync(undefined);
        },
        forget: (rowIds) => {
          forgotten.push(rowIds);
          return okAsync(undefined);
        },
      },
      answerFromCache: (version) => {
        answered.push(version);
        return okAsync(undefined);
      },
      fullRead: () => {
        fullReads += 1;
        return okAsync(undefined);
      },
    });

    expect(reached._unsafeUnwrap()).toBe(6);
    expect(read.map((chunk) => chunk.length)).toEqual([100, 20]);
    expect(forgotten).toEqual([['omar']]);
    expect(answered).toEqual([6]);
    expect(fullReads).toBe(0);
  });

  it('reads the table whole when the journal cannot be read', async () => {
    let fullReads = 0;

    const reached = await refreshChangedRows({
      from: 4,
      version: 6,
      changes: {
        since: () => errAsync('offline'),
        readRows: () => okAsync(undefined),
        forget: () => okAsync(undefined),
      },
      answerFromCache: () => {
        throw new Error('nothing was read into the cache');
      },
      fullRead: () => {
        fullReads += 1;
        return okAsync(undefined);
      },
    });

    expect(reached._unsafeUnwrap()).toBe(6);
    expect(fullReads).toBe(1);
  });

  it('reads the table whole after a column change', async () => {
    const read: string[][] = [];
    let fullReads = 0;

    await refreshChangedRows({
      from: 4,
      version: 5,
      changes: {
        since: () =>
          okAsync({
            version: 5,
            complete: true,
            truncated: false,
            rows: [{ row: 'maria', kind: 'update' as const }],
            columns: [{ column: 'plus-ones', kind: 'delete' as const }],
          }),
        readRows: (rowIds) => {
          read.push(rowIds);
          return okAsync(undefined);
        },
        forget: () => okAsync(undefined),
      },
      answerFromCache: () => {
        throw new Error('nothing was read into the cache');
      },
      fullRead: () => {
        fullReads += 1;
        return okAsync(undefined);
      },
    });

    expect(read).toEqual([]);
    expect(fullReads).toBe(1);
  });
});
