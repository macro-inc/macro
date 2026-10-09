import { describe, expect, it } from 'vitest';
import { keyHintChunks, refreshPlan } from './refresh-plan';

describe('catching a table read up', () => {
  it('reads just the written rows and forgets the removed ones', () => {
    expect(
      refreshPlan(
        {
          version: 9,
          complete: true,
          truncated: false,
          rows: [
            { row: 'maria', kind: 'update' },
            { row: 'omar', kind: 'delete' },
          ],
          columns: [],
        },
        9
      )
    ).toEqual({
      kind: 'rows',
      written: ['maria'],
      removed: ['omar'],
      version: 9,
    });
  });

  it('reads the table whole on a column change, a gap, an added row, or too many rows', () => {
    const base = {
      version: 9,
      complete: true,
      truncated: false,
      rows: [{ row: 'maria', kind: 'update' as const }],
      columns: [],
    };

    expect(
      refreshPlan(
        { ...base, columns: [{ column: 'plus-ones', kind: 'delete' }] },
        9
      )
    ).toEqual({ kind: 'full' });
    expect(refreshPlan({ ...base, complete: false }, 9)).toEqual({
      kind: 'full',
    });
    expect(
      refreshPlan({ ...base, rows: [{ row: 'ana', kind: 'insert' }] }, 9)
    ).toEqual({ kind: 'full' });
    expect(refreshPlan({ ...base, truncated: true, rows: [] }, 9)).toEqual({
      kind: 'full',
    });
    expect(
      refreshPlan(
        {
          ...base,
          rows: Array.from({ length: 301 }, (_, index) => ({
            row: `row-${index}`,
            kind: 'update' as const,
          })),
        },
        9
      )
    ).toEqual({ kind: 'full' });
    expect(refreshPlan(base, 10)).toEqual({ kind: 'full' });
  });

  it('reads rows by id in chunks the engine narrows', () => {
    const ids = Array.from({ length: 250 }, (_, index) => `row-${index}`);

    expect(keyHintChunks(ids).map((chunk) => chunk.length)).toEqual([
      100, 100, 50,
    ]);
  });
});
