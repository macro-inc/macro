import { expect, it } from 'vitest';
import { keepUnchangedRows } from './unchanged-rows';

it('returns the earlier list when every row holds the same data in the same place', () => {
  const previous = [
    { id: 'a', name: 'Alpha', viewedAt: new Date('2026-09-26T12:00:00Z') },
    { id: 'b', name: 'Beta', viewedAt: new Date('2026-09-26T12:00:00Z') },
  ];

  expect(
    keepUnchangedRows(previous, [
      { id: 'a', name: 'Alpha', viewedAt: new Date('2026-09-26T12:00:00Z') },
      { id: 'b', name: 'Beta', viewedAt: new Date('2026-09-26T12:00:00Z') },
    ])
  ).toBe(previous);
});

it('keeps unchanged row objects and takes the new object for a changed row', () => {
  const previous = [
    { id: 'a', name: 'Alpha', viewedAt: new Date('2026-09-26T12:00:00Z') },
    { id: 'b', name: 'Beta', viewedAt: new Date('2026-09-26T12:00:00Z') },
  ];
  const renamed = {
    id: 'b',
    name: 'Gamma',
    viewedAt: new Date('2026-09-26T12:00:00Z'),
  };

  const rows = keepUnchangedRows(previous, [
    { id: 'a', name: 'Alpha', viewedAt: new Date('2026-09-26T12:00:00Z') },
    renamed,
  ]);

  expect(rows).not.toBe(previous);
  expect(rows[0]).toBe(previous[0]);
  expect(rows[1]).toBe(renamed);
});

it('sees a newer view, a reorder, an added row and a removed row as a new list', () => {
  const previous = [
    { id: 'a', name: 'Alpha', viewedAt: new Date('2026-09-26T12:00:00Z') },
    { id: 'b', name: 'Beta', viewedAt: new Date('2026-09-26T12:00:00Z') },
  ];

  const viewed = keepUnchangedRows(previous, [
    { id: 'a', name: 'Alpha', viewedAt: new Date('2026-09-27T12:00:00Z') },
    { id: 'b', name: 'Beta', viewedAt: new Date('2026-09-26T12:00:00Z') },
  ]);
  expect(viewed[0].viewedAt).toEqual(new Date('2026-09-27T12:00:00Z'));

  const reordered = keepUnchangedRows(previous, [
    { id: 'b', name: 'Beta', viewedAt: new Date('2026-09-26T12:00:00Z') },
    { id: 'a', name: 'Alpha', viewedAt: new Date('2026-09-26T12:00:00Z') },
  ]);
  expect(reordered).toEqual([previous[1], previous[0]]);
  expect(reordered).not.toBe(previous);

  expect(
    keepUnchangedRows(previous, [
      ...previous,
      { id: 'c', name: 'Gamma', viewedAt: new Date('2026-09-26T12:00:00Z') },
    ])
  ).toHaveLength(3);
  expect(keepUnchangedRows(previous, [previous[0]])).toEqual([previous[0]]);
});
