import { gql } from '@urql/core';
import fc from 'fast-check';
import { createComputed, createRoot } from 'solid-js';
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
});
