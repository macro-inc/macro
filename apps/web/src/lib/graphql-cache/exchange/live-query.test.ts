import { createRequest, gql, makeOperation } from '@urql/core';
import { createComputed, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createKeyedProjection } from '../../urql-solid/create-keyed-projection';
import { LiveQuery, querySnapshot } from './live-query';

type Row = { __typename: string; id: string; isRead: boolean; title: string };
const document = gql`query Rows { rows { __typename id isRead title } }`;
const operation = makeOperation('query', createRequest(document, {}), {
  url: '/graphql',
  requestPolicy: 'cache-first',
});
const patch = (isRead: boolean) => [
  { kind: 'fields' as const, key: 'Thread:17', fields: { isRead } },
];

describe('live query field propagation', () => {
  it('patches one of 1,000 rows without remapping or notifying unrelated fields', () => {
    createRoot((dispose) => {
      const rows: Row[] = Array.from({ length: 1000 }, (_, id) => ({
        __typename: 'Thread',
        id: String(id),
        isRead: false,
        title: `Thread ${id}`,
      }));
      const view = new LiveQuery(operation, { rows });
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
      expect(view.apply(patch(true))).toBe(true);
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

      expect(view.apply(patch(false))).toBe(true);
      expect(observed).toEqual([false, true, false]);
      expect((optimisticSnapshot.rows as Row[])[17].isRead).toBe(true);
      expect(maps).toBe(1002);
      dispose();
      view.apply(patch(true));
      expect(maps).toBe(1002);
    });
  });

  it('resolves aliases and fragments while leaving unselected fields alone', () => {
    const aliased = gql`query Alias { thread { kind: __typename key: id ...Read } }
      fragment Read on Thread { seen: isRead }`;
    const view = new LiveQuery(
      makeOperation('query', createRequest(aliased, {}), {
        url: '/graphql',
        requestPolicy: 'cache-first',
      }),
      {
        thread: { kind: 'Thread', key: '17', seen: false },
      }
    );
    expect(view.apply(patch(true))).toBe(true);
    expect(view.data).toEqual({
      thread: { kind: 'Thread', key: '17', seen: true },
    });
    expect(
      view.apply([
        { kind: 'fields', key: 'Thread:17', fields: { title: 'Changed' } },
      ])
    ).toBe(true);
    expect(view.data).toEqual({
      thread: { kind: 'Thread', key: '17', seen: true },
    });
  });

  it('falls back atomically for shape changes and unknown dependencies', () => {
    const view = new LiveQuery(operation, {
      rows: [{ __typename: 'Thread', id: '17', isRead: false, title: 'A' }],
    });
    expect(
      view.apply([...patch(true), { kind: 'invalidate', key: 'Thread:17' }])
    ).toBe(false);
    expect(
      view.apply([
        { kind: 'fields', key: 'Thread:unknown', fields: { isRead: true } },
      ])
    ).toBe(false);
    expect(view.data).toEqual({
      rows: [{ __typename: 'Thread', id: '17', isRead: false, title: 'A' }],
    });
  });
});
