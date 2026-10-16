import { expect, it } from 'vitest';
import { ganttGroupPlacement } from './gantt-group-placement';

type Row = { group?: string; entity?: { id: string; rank: number } };
const source: Row = { group: 'a', entity: { id: 'one', rank: 2 } };
const rows: Row[] = [
  { group: 'a' },
  source,
  { group: 'b' },
  { group: 'b', entity: { id: 'fresh', rank: 1 } },
  { group: 'b', entity: { id: 'older', rank: 3 } },
  { group: 'b' },
  { group: 'c' },
];
function placement(items: Row[]) {
  return ganttGroupPlacement({
    items,
    move: { id: 'one', fromGroup: 'a', toGroup: 'b' },
    getEntity: (row) => row.entity,
    getGroup: (row) => row.group,
    compare: (left, right) => left.rank - right.rank,
  });
}

it('uses active sorting and keeps the ghost before group pagination', () => {
  expect(placement(rows)).toEqual({ index: 4 });
  expect(
    placement(
      rows.map((row) =>
        row === source ? { ...source, entity: { id: 'one', rank: 4 } } : row
      )
    )
  ).toEqual({ index: 5 });
});

it('places a ghost after a collapsed destination header without expanding the group', () => {
  expect(
    placement([{ group: 'a' }, source, { group: 'b' }, { group: 'c' }])
  ).toEqual({ index: 3 });
});

it('replaces an already-present assignee placement instead of creating a duplicate', () => {
  expect(
    placement([
      ...rows.slice(0, 4),
      { group: 'b', entity: source.entity },
      ...rows.slice(4),
    ])
  ).toEqual({ index: 4, replace: true });
});
