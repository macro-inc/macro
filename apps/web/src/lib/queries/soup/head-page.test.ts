import { expect, it, vi } from 'vitest';
import { mergeHeadRows } from './head-page';

it('keeps the fresh head copy when its id also appears in an older tail page', () => {
  const rows = mergeHeadRows(
    [
      { id: 'replied', time: 20, preview: 'New reply' },
      { id: 'other', time: 10, preview: 'Other' },
    ],
    [{ id: 'replied', time: 1, preview: 'Old reply' }],
    (row) => row.id,
    (row) => row.time,
    'DESC'
  );
  expect(rows.map((row) => row.id)).toEqual(['replied', 'other']);
  expect(rows[0].preview).toBe('New reply');
});

it('drops a retained row absent from the authoritative head range and keeps the older continuation', () => {
  const rows = mergeHeadRows(
    [
      { id: 'newest', time: 10 },
      { id: 'edge', time: 8 },
    ],
    [
      { id: 'archived-elsewhere', time: 9 },
      { id: 'tail', time: 7 },
    ],
    (row) => row.id,
    (row) => row.time,
    'DESC'
  );
  expect(rows.map((row) => row.id)).toEqual(['newest', 'edge', 'tail']);
});

it('decorates each unique row once rather than remapping it for every comparison', () => {
  const timestamp = vi.fn((row: { id: string; time: number }) => row.time);
  const head = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    time: 100 - i,
  }));
  const tail = Array.from({ length: 100 }, (_, i) => ({
    id: String(100 + i),
    time: -i,
  }));
  const rows = mergeHeadRows(head, tail, (row) => row.id, timestamp, 'DESC');
  expect(rows).toHaveLength(200);
  expect(timestamp).toHaveBeenCalledTimes(200);
});

it('retains an unknown boundary tie because millisecond precision cannot prove its removal', () => {
  const rows = mergeHeadRows(
    [
      { id: 'newest', time: 10 },
      { id: 'z-edge', time: 8 },
    ],
    [
      { id: 'a-boundary', time: 8 },
      { id: 'archived-elsewhere', time: 9 },
      { id: 'tail', time: 7 },
    ],
    (row) => row.id,
    (row) => row.time,
    'DESC'
  );
  expect(rows.map((row) => row.id)).toEqual([
    'newest',
    'z-edge',
    'a-boundary',
    'tail',
  ]);
});
