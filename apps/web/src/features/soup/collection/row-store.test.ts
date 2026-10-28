import type { EntityData } from '@entity';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it } from 'vitest';
import { createSoupRowStore } from './row-store';
import { buildFlatSoupRows } from './rows';

type Task = EntityData & { name: string; tags: string[] };

const task = (id: string, name: string, tags: string[] = []): Task =>
  ({ id, type: 'document', name, tags }) as Task;

describe('createSoupRowStore', () => {
  it('keeps each row object across rebuilds', () => {
    createRoot((dispose) => {
      const [tasks, setTasks] = createSignal([task('a', 'A'), task('b', 'B')]);
      const rows = createSoupRowStore(() => buildFlatSoupRows(tasks()));
      const [first, second] = rows();

      setTasks([task('a', 'A'), task('b', 'B')]);
      expect(rows()[0]).toBe(first);
      expect(rows()[1]).toBe(second);
      dispose();
    });
  });

  it('updates a changed field in place and notifies only its readers', () => {
    createRoot((dispose) => {
      const [tasks, setTasks] = createSignal([task('a', 'A'), task('b', 'B')]);
      const rows = createSoupRowStore(() => buildFlatSoupRows(tasks()));
      const first = rows()[0];
      const names: string[] = [];
      createComputed(() => {
        const row = rows()[1];
        if (row?.kind === 'entity') names.push(row.entity.name);
      });

      setTasks([task('a', 'A'), task('b', 'B renamed')]);
      expect(rows()[0]).toBe(first);
      expect(names).toEqual(['B', 'B renamed']);
      dispose();
    });
  });

  it('follows in-place updates of a query store without new rows', () => {
    createRoot((dispose) => {
      const [query, setQuery] = createStore({ tasks: [task('a', 'A', ['x'])] });
      const rows = createSoupRowStore(() => buildFlatSoupRows(query.tasks));
      const row = rows()[0];

      setQuery('tasks', 0, 'tags', ['x', 'y']);
      expect(rows()[0]).toBe(row);
      expect(row?.kind === 'entity' && [...(row.entity as Task).tags]).toEqual([
        'x',
        'y',
      ]);
      dispose();
    });
  });

  it('reuses surviving rows when rows are added, removed or reordered', () => {
    createRoot((dispose) => {
      const [tasks, setTasks] = createSignal([task('a', 'A'), task('b', 'B')]);
      const rows = createSoupRowStore(() => buildFlatSoupRows(tasks()));
      const [a, b] = rows();

      setTasks([task('c', 'C'), task('b', 'B'), task('a', 'A')]);
      expect(rows().map((row) => row.id)).toHaveLength(3);
      expect(rows()[1]).toBe(b);
      expect(rows()[2]).toBe(a);

      setTasks([task('a', 'A')]);
      expect(rows()).toEqual([a]);
      expect(rows()[0]).toBe(a);
      dispose();
    });
  });

  it('never writes into the objects of the store it reads from', () => {
    createRoot((dispose) => {
      const [query] = createStore({ tasks: [task('a', 'A', ['x'])] });
      const [local, setLocal] = createSignal<Task[] | undefined>();
      const rows = createSoupRowStore(() =>
        buildFlatSoupRows(local() ?? query.tasks)
      );
      const row = rows()[0];

      // Switch to a local result for the same entity with different values.
      setLocal([task('a', 'A local', ['z'])]);
      expect(rows()[0]).toBe(row);
      expect(row?.kind === 'entity' && row.entity.name).toBe('A local');
      expect(query.tasks[0]?.name).toBe('A');
      expect([...(query.tasks[0]?.tags ?? [])]).toEqual(['x']);
      dispose();
    });
  });
});
