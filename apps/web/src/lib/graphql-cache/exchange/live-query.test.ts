import v8 from 'node:v8';
import vm from 'node:vm';
import { gql } from '@urql/core';
import fc from 'fast-check';
import { $PROXY, createComputed, createRoot } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { describe, expect, it } from 'vitest';
import { createKeyedProjection } from '../../queries/soup/create-keyed-projection';
import { supportsStoreReconciliation } from '../../urql-solid/reactive-selection';
import { LiveQuery, querySnapshot } from './live-query';
import { applyQueryPatches } from './query-patches';
import { queryShape } from './query-shape';

type Row = { __typename: string; id: string; isRead: boolean; title: string };
const apply = (view: LiveQuery, isRead: boolean) =>
  view.replace(
    applyQueryPatches(view.snapshot, [
      { path: ['rows', 17, 'isRead'], value: isRead },
    ])
  );

describe('live query field propagation', () => {
  it('preserves unchanged untyped properties through structural snapshots without notifying their readers', () => {
    createRoot((dispose) => {
      try {
        const shape = queryShape(gql`query Rows {
          user { id rows { __typename id properties { id value { __typename optionIds } } } }
        }`);
        const initial = {
          user: {
            id: 'viewer',
            rows: Array.from({ length: 1000 }, (_, id) => ({
              __typename: 'Task',
              id: String(id),
              properties: [
                {
                  id: `property-${id}`,
                  value: {
                    __typename: 'Options',
                    optionIds: ['initial'],
                  },
                },
              ],
            })),
          },
        };
        const view = new LiveQuery(initial, shape);
        const held = (view.data as typeof initial).user.rows[18];
        const property = held.properties[0];
        let reads = 0;
        createComputed(() => {
          held.properties[0].value.optionIds.join(',');
          reads++;
        });
        for (const optionIds of [['changed'], [], ['initial']]) {
          const next = structuredClone(initial);
          next.user.rows[17].properties[0].value.optionIds = optionIds;
          next.user.rows.reverse();
          view.replace(next);
          expect((view.data as typeof initial).user.rows[981]).toBe(held);
          expect(held.properties[0]).toBe(property);
          expect(reads).toBe(1);
          expect(JSON.parse(JSON.stringify(view.data))).toEqual(next);
        }
      } finally {
        dispose();
      }
    });
  });
  it('keeps typed descendants reactive when a structural snapshot replaces an untyped ancestor', () => {
    const shape = queryShape(
      gql`query Rows { user { id rows { __typename id name properties { __typename id } } } }`
    );
    const row = {
      __typename: 'Task',
      id: 'task',
      name: 'Task',
      properties: [{ __typename: 'Property', id: 'tag' }],
    };
    const view = new LiveQuery({ user: { id: 'viewer', rows: [row] } }, shape);
    const before = view.data.user as { id: string; rows: (typeof row)[] };
    const held = before.rows[0];
    view.replace({
      user: { id: 'viewer', rows: [{ ...row, properties: [] }] },
    });
    expect(view.data.user).not.toBe(before);
    expect((view.data.user as typeof before).rows[0]).toBe(held);
    expect(held.properties).toEqual([]);
    view.replace({
      user: { id: 'viewer', rows: [{ ...row, name: 'Renamed' }] },
    });
    expect(held.name).toBe('Renamed');
    expect(held.properties[0].id).toBe('tag');
  });
  it('replaces same-ID entities when their concrete type is not selected', () => {
    const shape = queryShape(gql`query Rows {
      rows { ... on Task { id name } ... on Project { id name } }
      selected { ... on Task { id name } ... on Project { id name } }
    }`);
    const task = { id: 'shared', name: 'task' };
    const project = { id: 'shared', name: 'project' };
    const view = new LiveQuery(
      { rows: [task, project], selected: task },
      shape
    );
    const held = (view.data.rows as object[])[0];
    const selected = view.data.selected;
    view.replace({ rows: [project, task], selected: project });
    expect(held).toEqual(task);
    expect(selected).toEqual(task);
    expect((view.data.rows as object[])[0]).not.toBe(held);
    expect(view.data.selected).not.toBe(selected);
    expect(JSON.parse(JSON.stringify(view.data))).toEqual({
      rows: [project, task],
      selected: project,
    });
  });
  it('preserves concrete entity identity through aliased union list patches and snapshots', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/), {
          minLength: 3,
          maxLength: 3,
        }),
        fc.boolean(),
        ([id, type, title], incremental) => {
          const shape = queryShape(
            gql(
              `query Rows { rows { ...Fields } } fragment Fields on Entity { ${id}: id ${type}: __typename ${title}: name }`
            )
          );
          const initial = {
            rows: [
              { [id]: 'shared', [type]: 'Task', [title]: 'task' },
              { [id]: 'shared', [type]: 'Project', [title]: 'project' },
            ],
          };
          // Reserved aliases deliberately use the immutable-result fallback.
          if (!supportsStoreReconciliation(initial)) return;
          const view = new LiveQuery(initial, shape);
          const rows = view.data.rows as Record<string, unknown>[];
          const task = rows[0];
          const project = rows[1];
          const next = {
            rows: [initial.rows[1], { ...initial.rows[0], [title]: 'changed' }],
          };
          view.replace(
            incremental
              ? applyQueryPatches(view.snapshot, [
                  { path: ['rows'], value: next.rows },
                ])
              : next
          );
          expect((view.data.rows as object[])[0]).toBe(project);
          expect((view.data.rows as object[])[1]).toBe(task);
          expect(task[type]).toBe('Task');
          expect(task[title]).toBe('changed');
          expect(JSON.parse(JSON.stringify(view.data))).toEqual(next);
        }
      ),
      {
        numRuns: Number(process.env.CACHE_FUZZ_RUNS ?? 250),
        seed: process.env.CACHE_FUZZ_SEED
          ? Number(process.env.CACHE_FUZZ_SEED)
          : undefined,
      }
    );
  });

  it('replaces identity-changing rows and keeps null/object transitions coherent', () => {
    const view = new LiveQuery({
      rows: [{ __typename: 'Task', id: 'a', owner: { id: 'x' } }],
    });
    const first = (view.data.rows as { id: string; owner: unknown }[])[0];
    view.replace(
      applyQueryPatches(view.snapshot, [
        { path: ['rows', 0, 'id'], value: 'b' },
      ])
    );
    expect((view.data.rows as object[])[0]).not.toBe(first);
    expect(first.id).toBe('a');
    for (const owner of [null, { id: 'y' }, null]) {
      view.replace(
        applyQueryPatches(view.snapshot, [
          { path: ['rows', 0, 'owner'], value: owner },
        ])
      );
      expect(JSON.parse(JSON.stringify(view.data))).toEqual({
        rows: [{ __typename: 'Task', id: 'b', owner }],
      });
    }
  });

  it.each(['constructor', 'prototype', '__proto__'])(
    'preserves %s in immutable patches and explicitly requires snapshot fallback',
    (alias) => {
      const base = JSON.parse(`{"nested":{"${alias}":"selected"}}`);
      const next = applyQueryPatches(base, [
        { path: ['nested', alias], value: 'updated' },
      ]);
      expect(JSON.parse(JSON.stringify(next))).toEqual({
        nested: { [alias]: 'updated' },
      });
      expect(supportsStoreReconciliation(next)).toBe(false);
      expect(() => new LiveQuery(next)).toThrow('snapshot fallback');
      expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    }
  );

  it('patches one of 1,000 rows without remapping or notifying unrelated fields', () => {
    createRoot((dispose) => {
      const rows: Row[] = Array.from({ length: 1000 }, (_, id) => ({
        __typename: 'Thread',
        id: String(id),
        isRead: false,
        title: `Thread ${id}`,
      }));
      const view = new LiveQuery({ rows });
      const live = view.data as { rows: Row[] };
      const identities = [...live.rows];
      const snapshots: { rows: Row[] }[] = [];
      createComputed(() => snapshots.push(querySnapshot(live)));
      let maps = 0;
      const projected = createKeyedProjection(
        () => live.rows,
        (row) => row.id,
        (row) => {
          maps += 1;
          return { id: row.id, read: row.isRead, title: row.title };
        }
      );
      const observed: boolean[] = [];
      let titleReads = 0;
      let otherReads = 0;
      createComputed(() => observed.push(projected()[17].read));
      createComputed(() => {
        projected()[17].title;
        titleReads += 1;
      });
      createComputed(() => {
        projected()[18].read;
        otherReads += 1;
      });

      expect(maps).toBe(1000);
      apply(view, true);
      expect(maps).toBe(1001);
      expect(observed).toEqual([false, true]);
      expect(titleReads).toBe(1);
      expect(otherReads).toBe(1);
      expect(live.rows.every((row, index) => row === identities[index])).toBe(
        true
      );
      expect(rows[17].isRead).toBe(false);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].rows[17].isRead).toBe(false);
      expect(snapshots[1].rows[17].isRead).toBe(true);
      const optimisticSnapshot = view.snapshot;
      expect((optimisticSnapshot.rows as Row[])[17].isRead).toBe(true);
      expect((optimisticSnapshot.rows as Row[])[18]).toBe(rows[18]);

      apply(view, false);
      expect(observed).toEqual([false, true, false]);
      expect((optimisticSnapshot.rows as Row[])[17].isRead).toBe(true);
      expect(maps).toBe(1002);
      dispose();
      apply(view, true);
      expect(maps).toBe(1002);
    });
  });

  it('preserves keyed object identity when structural changes replace the snapshot', () => {
    const view = new LiveQuery({
      rows: [
        { __typename: 'Task', id: 'a', read: false },
        { __typename: 'Task', id: 'b', read: false },
      ],
    });
    const before = view.data.rows as object[];
    const first = before[0];
    view.replace({
      rows: [
        { __typename: 'Task', id: 'b', read: false },
        { __typename: 'Task', id: 'a', read: true },
      ],
    });
    expect((view.data.rows as object[])[1]).toBe(first);
    expect(first).toEqual({ __typename: 'Task', id: 'a', read: true });
  });

  it.each([
    { __typename: 'Task', id: 'c', tags: ['second'] },
    { id: 'c', tags: ['second'] },
    { tags: ['second'] },
  ])('does not borrow a reordered row for a new identity: %j', (inserted) => {
    const view = new LiveQuery({
      rows: [
        { __typename: 'Task', id: 'a', tags: ['first'] },
        { __typename: 'Task', id: 'b', tags: ['second'] },
      ],
    });
    const before = view.snapshot;
    const retained = (view.data.rows as object[])[1];
    const next = {
      rows: [{ __typename: 'Task', id: 'b', tags: ['first'] }, inserted],
    };
    view.replace(next);
    expect(view.data).toEqual(next);
    expect((view.data.rows as object[])[0]).toBe(retained);
    expect(before.rows).toEqual([
      { __typename: 'Task', id: 'a', tags: ['first'] },
      { __typename: 'Task', id: 'b', tags: ['second'] },
    ]);
  });

  it('preserves row identity and unchanged observers when a list field is patched', () => {
    createRoot((dispose) => {
      const view = new LiveQuery({
        rows: [
          { __typename: 'Task', id: 'a', tags: [] },
          { __typename: 'Task', id: 'b', tags: [] },
        ],
      });
      const live = view.data as { rows: { id: string; tags: string[] }[] };
      const first = live.rows[0];
      let reads = 0;
      createComputed(() => {
        first.tags.join(',');
        reads++;
      });
      view.replace(
        applyQueryPatches(view.snapshot, [
          {
            path: ['rows', 0, 'tags'],
            value: [],
          },
        ])
      );
      expect(reads).toBe(1);
      view.replace(
        applyQueryPatches(view.snapshot, [
          {
            path: ['rows'],
            value: [
              { __typename: 'Task', id: 'b', tags: [] },
              { __typename: 'Task', id: 'a', tags: ['tag'] },
            ],
          },
        ])
      );
      expect(live.rows[1]).toBe(first);
      expect(first.tags).toEqual(['tag']);
      expect(reads).toBe(2);
      dispose();
    });
  });

  it('publishes a snapshot equal to every result, sharing only unchanged rows', () => {
    type Item = {
      __typename: 'Item';
      id: string;
      name: string;
      tags: string[];
    };
    const item = (id: number, name = `n${id}`): Item => ({
      __typename: 'Item',
      id: String(id),
      name,
      tags: [name],
    });
    const step = fc.oneof(
      // Several patches in one result, the last possibly restoring an
      // object an earlier result held.
      fc.record({
        kind: fc.constant('patch' as const),
        edits: fc.array(
          fc.record({
            at: fc.nat(),
            name: fc.string({ maxLength: 2 }),
            restore: fc.boolean(),
          }),
          { minLength: 1, maxLength: 3 }
        ),
      }),
      fc.record({
        kind: fc.constant('full' as const),
        at: fc.nat(),
        rename: fc.boolean(),
      }),
      fc.record({
        kind: fc.constant('list' as const),
        at: fc.nat(),
        insert: fc.boolean(),
      })
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 25 }), (steps) =>
        createRoot((dispose) => {
          try {
            let data: { rows: Item[] } = {
              rows: Array.from({ length: 6 }, (_, id) => item(id)),
            };
            const history = [...data.rows];
            const view = new LiveQuery(data);
            let shown = querySnapshot(view.data) as typeof data;
            for (const [index, change] of steps.entries()) {
              const count = data.rows.length;
              if (change.kind === 'patch' && count) {
                data = applyQueryPatches(
                  data,
                  // One edit per row: patches in one result never overlap.
                  [
                    ...new Map(
                      change.edits.map((edit) => [edit.at % count, edit])
                    ),
                  ].map(([row, { at, name, restore }]) => {
                    // A rollback restores an earlier object of the same row.
                    const earlier = history.filter(
                      (candidate) => candidate.id === data.rows[row].id
                    );
                    return restore
                      ? {
                          path: ['rows', row],
                          value: earlier[at % earlier.length],
                        }
                      : { path: ['rows', row, 'name'], value: name };
                  })
                ) as typeof data;
              } else if (change.kind === 'full') {
                data = structuredClone(data);
                if (change.rename && count)
                  data.rows[change.at % count].name = `r${index}`;
              } else if (change.kind === 'list') {
                const rows = [...data.rows];
                if (change.insert)
                  rows.splice(change.at % (count + 1), 0, item(100 + index));
                else if (count) rows.splice(change.at % count, 1);
                data = applyQueryPatches(data, [
                  { path: ['rows'], value: rows },
                ]) as typeof data;
              }
              history.push(...data.rows);
              const before = shown;
              view.replace(data);
              shown = querySnapshot(view.data) as typeof data;
              expect(shown).toEqual(data);
              for (const row of shown.rows) {
                const old = before.rows.find(
                  (candidate) => candidate.id === row.id
                );
                if (old && JSON.stringify(old) === JSON.stringify(row))
                  expect(row).toBe(old);
              }
            }
          } finally {
            dispose();
          }
        })
      ),
      { seed: 12_400, numRuns: 400 }
    );
  });

  it("keeps every unchanged row's snapshot object, whatever replaced the list", () => {
    type NestedRow = {
      __typename: string;
      id: string;
      isRead: boolean;
      participants: Array<{ userId: string; role: string }>;
    };
    createRoot((dispose) => {
      const rows: NestedRow[] = Array.from({ length: 20 }, (_, id) => ({
        __typename: 'Channel',
        id: String(id),
        isRead: false,
        participants: Array.from({ length: 15 }, (_, p) => ({
          userId: `user-${p}`,
          role: 'MEMBER',
        })),
      }));
      const view = new LiveQuery({ rows });
      const snapshotRows = () =>
        (querySnapshot(view.data) as { rows: NestedRow[] }).rows;
      let maps = 0;
      const projected = createKeyedProjection(
        snapshotRows,
        (row) => row.id,
        (row) => {
          maps += 1;
          expect(Reflect.get(row, $PROXY)).toBeUndefined();
          return {
            id: row.id,
            read: row.isRead,
            members: row.participants.map((p) => `${p.userId}:${p.role}`),
          };
        }
      );

      expect(projected()).toHaveLength(20);
      expect(maps).toBe(20);

      // A field patch remaps its row.
      view.replace(
        applyQueryPatches(view.snapshot, [
          { path: ['rows', 5, 'isRead'], value: true },
        ])
      );
      expect(maps).toBe(21);
      expect(projected()[5].read).toBe(true);
      expect(projected()[4].read).toBe(false);

      // A full result remaps only the row that changed.
      const fullNext = structuredClone(view.snapshot as { rows: NestedRow[] });
      fullNext.rows[7].isRead = true;
      view.replace(fullNext);
      expect(maps).toBe(22);
      expect(projected()[7].read).toBe(true);

      // A patch that replaces the list (a reorder) remaps nothing.
      const before = snapshotRows();
      const reordered = [...(view.snapshot as { rows: NestedRow[] }).rows];
      reordered.unshift(...reordered.splice(9, 1));
      view.replace(
        applyQueryPatches(view.snapshot, [
          { path: ['rows'], value: structuredClone(reordered) },
        ])
      );
      expect(maps).toBe(22);
      expect(snapshotRows()[0]).toBe(before[9]);
      expect(projected().map((row) => row.id)[0]).toBe('9');

      // An insert maps the new row only.
      const kept = snapshotRows();
      view.replace({
        rows: [
          ...structuredClone((view.snapshot as { rows: NestedRow[] }).rows),
          { ...structuredClone(rows[0]), id: 'new' },
        ],
      });
      expect(maps).toBe(23);
      expect(
        snapshotRows()
          .slice(0, 20)
          .every((row, index) => row === kept[index])
      ).toBe(true);
      dispose();
    });
  });

  it('does not retain the LiveQuery or sibling rows when a single row is held', async () => {
    v8.setFlagsFromString('--expose_gc');
    const runGc = vm.runInNewContext('gc') as () => void;

    const retainOneRow = () => {
      let view: LiveQuery | undefined = new LiveQuery({
        user: {
          soup: {
            items: [
              {
                __typename: 'GraphqlSoupChannel',
                id: 'ch-1',
                name: 'General',
                payload: 'a'.repeat(4096),
              },
              {
                __typename: 'GraphqlSoupChannel',
                id: 'ch-2',
                name: 'Random',
                payload: 'b'.repeat(4096),
              },
            ],
          },
        },
      });
      const items = (
        view.data as {
          user: { soup: { items: Array<{ id: string; name: string }> } };
        }
      ).user.soup.items;
      const keptRow = unwrap(items[0]);
      const siblingRow = unwrap(items[1]);
      // Read the snapshot inside a disposed computation too.
      createRoot((dispose) => {
        expect(querySnapshot(view!.data)).toMatchObject({
          user: { soup: { items: [{ name: 'General' }, { name: 'Random' }] } },
        });
        dispose();
      });
      const viewRef = new WeakRef(view);
      const siblingRef = new WeakRef(siblingRow);
      view = undefined;
      return { keptRow, viewRef, siblingRef };
    };

    const { keptRow, viewRef, siblingRef } = retainOneRow();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      runGc();
      if (!viewRef.deref() && !siblingRef.deref()) break;
    }

    expect(keptRow.id).toBe('ch-1');
    expect(viewRef.deref()).toBeUndefined();
    expect(siblingRef.deref()).toBeUndefined();
  });
});
