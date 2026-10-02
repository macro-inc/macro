import { createComputed, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createKeyedProjection } from '../../urql-solid/create-keyed-projection';
import { LiveQuery, querySnapshot } from './live-query';
import { applyQueryPatches } from './query-patches';

type Row = { __typename: string; id: string; isRead: boolean; title: string };
const apply = (view: LiveQuery, isRead: boolean) =>
  view.replace(
    applyQueryPatches(view.snapshot, [
      { path: ['rows', 17, 'isRead'], value: isRead },
    ])
  );

describe('live query field propagation', () => {
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
        { id: 'a', read: false },
        { id: 'b', read: false },
      ],
    });
    const before = view.data.rows as object[];
    const first = before[0];
    view.replace({
      rows: [
        { id: 'b', read: false },
        { id: 'a', read: true },
      ],
    });
    expect((view.data.rows as object[])[1]).toBe(first);
    expect(first).toEqual({ id: 'a', read: true });
  });
});
