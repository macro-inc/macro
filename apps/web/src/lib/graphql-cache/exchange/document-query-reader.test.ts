import { createComputed, createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { parseCacheRevision, type QueryUpdate } from '../protocol';
import { createDocumentQueryReader } from './document-query-reader';
import { LiveQuery } from './live-query';
import { applyQueryPatches } from './query-patches';

const revision = parseCacheRevision;
const args = { opKey: 1, query: 'query { rows { seen } }' };
const hit = (data: unknown, value = '1'): QueryUpdate => ({
  kind: 'hit',
  data,
  revision: revision(value),
});
const patch = (value: boolean, version = '2'): QueryUpdate => ({
  kind: 'patch',
  patches: [{ path: ['rows', 17, 'seen'], value }],
  revision: revision(version),
});

describe('document query projection', () => {
  it('applies engine paths without IDs or JS schema inference and preserves unrelated observers', async () => {
    const original = {
      rows: Array.from({ length: 1000 }, () => ({
        seen: false,
        title: 'Stable',
      })),
    };
    const watchQuery = vi
      .fn()
      .mockResolvedValueOnce(hit(original))
      .mockResolvedValueOnce(patch(true));
    const readQuery = vi.fn();
    const reader = createDocumentQueryReader({ watchQuery, readQuery });
    const first = await reader.read(args);
    if (first.kind !== 'hit') throw new Error('expected hit');
    const state = createRoot((dispose) => {
      const view = new LiveQuery(first.data as typeof original);
      const data = view.data as typeof original;
      const rows = [...data.rows];
      const seen: boolean[] = [];
      let otherReads = 0;
      createComputed(() => seen.push(data.rows[17].seen));
      createComputed(() => {
        data.rows[18].seen;
        data.rows[17].title;
        otherReads++;
      });
      return { view, data, rows, seen, otherReads: () => otherReads, dispose };
    });
    try {
      const next = await reader.read(args);
      if (next.kind !== 'hit') throw new Error('expected hit');
      state.view.replace(next.data as typeof original);
      expect(state.seen).toEqual([false, true]);
      expect(state.otherReads()).toBe(1);
      expect(
        state.data.rows.every((row, index) => row === state.rows[index])
      ).toBe(true);
      expect(original.rows[17].seen).toBe(false);
      expect(watchQuery.mock.calls[1][0].since).toBe('1');
      expect(readQuery).not.toHaveBeenCalled();
    } finally {
      state.dispose();
    }
  });

  it('isolates late responses across generation changes and teardown', async () => {
    let finish!: (update: QueryUpdate) => void;
    const watchQuery = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<QueryUpdate>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(hit({ rows: [] }, '0'));
    const reader = createDocumentQueryReader({
      watchQuery,
      readQuery: vi.fn(),
    });
    const pending = reader.read(args);
    reader.clear();
    await reader.read(args);
    finish(hit({ rows: ['old-account'] }, '100'));
    await pending;
    await reader.read(args);
    expect(watchQuery.mock.calls[2][0].since).toBe('0');
    reader.forget(1);
    await reader.read(args);
    expect(watchQuery.mock.calls[3][0].since).toBeUndefined();
  });

  it('discards stale cursors after a malformed patch and falls back for older hosts', async () => {
    const readQuery = vi.fn().mockResolvedValue({ kind: 'miss' });
    const watchQuery = vi
      .fn()
      .mockResolvedValueOnce(hit({ rows: [] }))
      .mockResolvedValueOnce(patch(true))
      .mockResolvedValueOnce({ kind: 'unsupported' });
    const reader = createDocumentQueryReader({ watchQuery, readQuery });
    await reader.read(args);
    await expect(reader.read(args)).rejects.toThrow('base');
    expect(await reader.read(args)).toEqual({ kind: 'miss' });
    expect(watchQuery.mock.calls[2][0].since).toBeUndefined();
    expect(readQuery).toHaveBeenCalledWith(args);
  });

  it('validates an entire patch batch before changing anything', () => {
    const base = { rows: [{ seen: false }] };
    expect(() =>
      applyQueryPatches(base, [
        { path: ['rows', 0, 'seen'], value: true },
        { path: ['rows', 20, 'seen'], value: true },
      ])
    ).toThrow();
    expect(base.rows[0].seen).toBe(false);
    expect(() =>
      applyQueryPatches(base, [{ path: ['__proto__'], value: {} }])
    ).toThrow();
  });
});
