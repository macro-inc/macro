import { createComputed, createRoot, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyedProjection } from './create-keyed-projection';

vi.mock('solid-js/store', async (importOriginal) => {
  const original = await importOriginal<typeof import('solid-js/store')>();
  return { ...original, reconcile: vi.fn(original.reconcile) };
});

beforeEach(() => vi.mocked(reconcile).mockClear());

describe('createKeyedProjection', () => {
  it('reconciles only changed rows when a large list rebuilds its wrappers', () => {
    createRoot((dispose) => {
      const [source, setSource] = createStore({
        rows: Array.from({ length: 1000 }, (_, id) => ({
          id,
          value: { tags: ['docs'], priority: 'low' },
        })),
      });
      const [revision, setRevision] = createSignal(0);
      const rows = createKeyedProjection(
        () => {
          revision();
          return source.rows.map((row) => ({ ...row }));
        },
        (row) => row.id,
        (row) => row
      );
      const retained = rows()[500];
      expect(reconcile).toHaveBeenCalledTimes(1000);
      setRevision(1);
      expect(reconcile).toHaveBeenCalledTimes(1000);
      setSource('rows', 500, 'value', 'priority', 'high');
      expect(reconcile).toHaveBeenCalledTimes(1001);
      expect(rows()[500]).toBe(retained);
      expect(retained.value.priority).toBe('high');
      expect(rows()[501].value.priority).toBe('low');
      setSource('rows', 500, 'value', 'priority', 'low');
      expect(retained.value.priority).toBe('low');
      expect(reconcile).toHaveBeenCalledTimes(1002);
      dispose();
    });
  });

  it('retains field subscriptions after skipping an unchanged projection', () => {
    createRoot((dispose) => {
      const [source, setSource] = createStore({ id: 'task', tags: ['docs'] });
      const [revision, setRevision] = createSignal(0);
      const rows = createKeyedProjection(
        () => {
          revision();
          return [{ ...source }];
        },
        (row) => row.id,
        (row) => row
      );
      const seen: string[] = [];
      createComputed(() => {
        seen.push(rows()[0].tags.join(','));
      });
      setRevision(1);
      setSource('tags', ['docs', 'review']);
      setRevision(2);
      setSource('tags', ['docs']);
      expect(seen).toEqual(['docs', 'docs,review', 'docs']);
      expect([...source.tags]).toEqual(['docs']);
      dispose();
    });
  });

  it('sees mutations of plain input objects when their list is republished', () => {
    createRoot((dispose) => {
      const input = { id: 'task', details: { name: 'before' } };
      const [source, setSource] = createSignal([input]);
      const rows = createKeyedProjection(
        source,
        (row) => row.id,
        (row) => row
      );
      input.details.name = 'after';
      expect(rows()[0].details.name).toBe('before');
      setSource([{ ...input }]);
      expect(rows()[0].details.name).toBe('after');
      input.details.name = 'rollback';
      setSource([{ ...input }]);
      expect(rows()[0].details.name).toBe('rollback');
      dispose();
    });
  });

  it('keeps nested keyed reorders independent from reconciliation writes', () => {
    createRoot((dispose) => {
      const [source, setSource] = createSignal([
        {
          id: 'parent',
          children: [
            { id: 'a', value: { v: 0 } },
            { id: 'b', value: { v: 1 } },
          ],
        },
      ]);
      const rows = createKeyedProjection(
        source,
        (row) => row.id,
        (row) => row
      );
      const first = rows()[0].children[0];
      const second = rows()[0].children[1];
      setSource([
        {
          id: 'parent',
          children: [
            { id: 'b', value: { v: 0 } },
            { id: 'a', value: { v: 1 } },
          ],
        },
      ]);
      expect(rows()).toEqual(source());
      expect(rows()[0].children).toEqual([second, first]);
      expect(first.value.v).toBe(1);
      expect(second.value.v).toBe(0);
      dispose();
    });
  });

  it('distinguishes missing fields, undefined, null, and non-plain objects', () => {
    createRoot((dispose) => {
      type Row = { id: string; value?: unknown };
      const [source, setSource] = createSignal<Row[]>([{ id: 'task' }]);
      const rows = createKeyedProjection(
        source,
        (row) => row.id,
        (row) => row
      );
      for (const value of [undefined, null, new Date(0), {}, [], new Date(1)]) {
        setSource([{ id: 'task', value }]);
        expect(rows()[0].value).toEqual(value);
      }
      setSource([{ id: 'task' }]);
      expect(rows()[0].value).toBeUndefined();
      dispose();
    });
  });
});
