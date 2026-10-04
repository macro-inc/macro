import fc from 'fast-check';
import { createComputed, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { QueryFieldPatch } from '../protocol';
import { LiveQuery, querySnapshot } from './live-query';
import { applyQueryPatches } from './query-patches';

type Row = {
  __typename: 'Task';
  id: string;
  title: string;
  done: boolean;
  priority: number | null;
  tags: string[];
};
type Snapshot = { rows: Row[] };
type Reads = { title: number; done: number; priority: number; tags: number };

const rowValue = fc.record({
  title: fc.string({ maxLength: 24 }),
  done: fc.boolean(),
  priority: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
  tags: fc.uniqueArray(fc.string({ maxLength: 8 }), { maxLength: 4 }),
});
const fieldEdit = fc.oneof(
  fc.record({
    field: fc.constant('title'),
    value: fc.string({ maxLength: 24 }),
  }),
  fc.record({ field: fc.constant('done'), value: fc.boolean() }),
  fc.record({
    field: fc.constant('priority'),
    value: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
  }),
  fc.record({
    field: fc.constant('tags'),
    value: fc.uniqueArray(fc.string({ maxLength: 8 }), { maxLength: 4 }),
  })
);
const action = fc
  .tuple(
    fc.boolean(),
    fc.oneof(
      fc.record({
        kind: fc.constant('patch' as const),
        index: fc.nat(20),
        edit: fieldEdit,
      }),
      fc.record({ kind: fc.constant('reverse' as const) }),
      fc.record({ kind: fc.constant('remove' as const), index: fc.nat(20) }),
      fc.record({ kind: fc.constant('insert' as const), row: rowValue }),
      fc.record({ kind: fc.constant('poll' as const) })
    )
  )
  .map(([incremental, action]) => ({ ...action, incremental }));

function observe(initial: Snapshot) {
  const view = new LiveQuery(initial);
  const data = view.data as Snapshot;
  const reads = new Map<string, Reads>();
  const observed = new Map<string, Row>();
  const snapshots: Snapshot[] = [];
  const rendered: Snapshot[] = [];
  createComputed(() => snapshots.push(querySnapshot(data)));
  createComputed(() => rendered.push(JSON.parse(JSON.stringify(data))));

  const attach = () => {
    for (const row of data.rows) {
      if (observed.get(row.id) === row) continue;
      observed.set(row.id, row);
      const count = { title: 0, done: 0, priority: 0, tags: 0 };
      reads.set(row.id, count);
      createComputed(() => {
        row.title;
        count.title++;
      });
      createComputed(() => {
        row.done;
        count.done++;
      });
      createComputed(() => {
        row.priority;
        count.priority++;
      });
      createComputed(() => {
        row.tags.join('\0');
        count.tags++;
      });
    }
  };
  attach();
  return { view, data, reads, snapshots, rendered, attach };
}

describe('generated live query updates', () => {
  it('keeps every intermediate snapshot coherent and only notifies changed fields', () => {
    fc.assert(
      fc.property(
        fc.array(rowValue, { minLength: 1, maxLength: 12 }),
        fc.array(action, { minLength: 1, maxLength: 80 }),
        (initial, actions) => {
          createRoot((dispose) => {
            try {
              const model: Snapshot = {
                rows: initial.map((row, index) => ({
                  ...row,
                  __typename: 'Task',
                  id: String(index),
                })),
              };
              let nextId = model.rows.length;
              const first = observe(structuredClone(model));
              const second = observe(structuredClone(model));
              const lagging = observe(structuredClone(model));
              const retained: Array<{ snapshot: object; expected: object }> =
                [];

              for (const action of actions) {
                const before = structuredClone(model);
                const identities = new Map(
                  first.data.rows.map((row) => [row.id, row])
                );
                const counters = new Map(
                  [...first.reads].map(([id, counts]) => [id, { ...counts }])
                );
                let patches: QueryFieldPatch[] | undefined;
                if (action.kind === 'patch' && model.rows.length) {
                  const index = action.index % model.rows.length;
                  const { field, value } = action.edit;
                  Object.assign(model.rows[index], { [field]: value });
                  patches = [{ path: ['rows', index, field], value }];
                } else if (action.kind === 'reverse') {
                  model.rows.reverse();
                } else if (action.kind === 'remove' && model.rows.length) {
                  model.rows.splice(action.index % model.rows.length, 1);
                } else if (action.kind === 'insert') {
                  model.rows.unshift({
                    ...action.row,
                    __typename: 'Task',
                    id: String(nextId++),
                  });
                }
                if (action.incremental) {
                  patches ??= [
                    { path: ['rows'], value: structuredClone(model.rows) },
                  ];
                } else {
                  patches = undefined;
                }

                for (const subscriber of [first, second]) {
                  const renders = subscriber.rendered.length;
                  retained.push({
                    snapshot: subscriber.view.snapshot,
                    expected: structuredClone(subscriber.view.snapshot),
                  });
                  const next = patches
                    ? applyQueryPatches(subscriber.view.snapshot, patches)
                    : structuredClone(model);
                  subscriber.view.replace(next);
                  subscriber.attach();
                  expect(querySnapshot(subscriber.data)).toEqual(model);
                  expect(subscriber.snapshots.at(-1)).toEqual(model);
                  expect(subscriber.rendered.at(-1)).toEqual(model);
                  for (const rendered of subscriber.rendered.slice(renders)) {
                    expect(rendered).toEqual(model);
                  }
                }
                if (action.kind === 'poll') {
                  lagging.view.replace(structuredClone(model));
                  expect(querySnapshot(lagging.data)).toEqual(model);
                  expect(lagging.rendered.at(-1)).toEqual(model);
                }

                // A row that remains present must retain its reactive identity,
                // even if it changes position or receives a full replacement.
                for (const row of first.data.rows) {
                  if (identities.has(row.id))
                    expect(row).toBe(identities.get(row.id));
                }
                if (action.kind === 'patch') {
                  for (const row of model.rows) {
                    const previous = before.rows.find(
                      (candidate) => candidate.id === row.id
                    )!;
                    const counts = first.reads.get(row.id)!;
                    const previousCounts = counters.get(row.id)!;
                    for (const field of [
                      'title',
                      'done',
                      'priority',
                      'tags',
                    ] as const) {
                      const changed =
                        JSON.stringify(previous[field]) !==
                        JSON.stringify(row[field]);
                      expect(counts[field] - previousCounts[field]).toBe(
                        Number(changed)
                      );
                    }
                  }
                }
                for (const { snapshot, expected } of retained) {
                  expect(snapshot).toEqual(expected);
                }
              }
              lagging.view.replace(structuredClone(model));
              expect(querySnapshot(lagging.data)).toEqual(model);
              const observed = first.snapshots.length;
              dispose();
              first.view.replace({ rows: [] });
              expect(first.snapshots).toHaveLength(observed);
            } finally {
              dispose();
            }
          });
        }
      ),
      {
        numRuns: Number(process.env.CACHE_FUZZ_RUNS ?? 250),
        seed: process.env.CACHE_FUZZ_SEED
          ? Number(process.env.CACHE_FUZZ_SEED)
          : undefined,
        path: process.env.CACHE_FUZZ_PATH,
      }
    );
  }, 60_000);
});
