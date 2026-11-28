import { expect, it } from 'vitest';
import { applyQueryPatches } from './query-patches';
import { shareQueryPatches, shareQueryValue } from './query-shape';

const rows = (count: number) => ({
  list: Array.from({ length: count }, (_, index) => ({
    __typename: 'Row',
    id: String(index),
    name: String(index),
    tags: [{ id: `${index}-tag` }],
  })),
});

it('shares many patches into one list as the patched result, keeping every other row', () => {
  const previous = rows(100);
  const patches = Array.from({ length: 60 }, (_, index) => ({
    path: ['list', index, 'name'],
    value: `renamed ${index}`,
  }));
  const next = applyQueryPatches(previous, [
    ...patches,
    { path: ['list', 80, 'tags'], value: [{ id: 'new' }] },
  ]);
  const shared = shareQueryPatches(previous, previous, [
    ...patches,
    { path: ['list', 80, 'tags'], value: [{ id: 'new' }] },
  ]) as typeof previous;
  expect(shared).toEqual(next);
  expect(shared.list[3].name).toBe('renamed 3');
  expect(shared.list[3].tags).toBe(previous.list[3].tags);
  expect(shared.list[79]).toBe(previous.list[79]);
  expect(shared.list[80]).not.toBe(previous.list[80]);
  expect(shared.list[80].name).toBe('80');
  expect(previous).toEqual(rows(100));
});

it('never shares a value that is not a plain object', () => {
  const previous = { at: new Date(1) };
  const next = { at: new Date(2) };
  expect((shareQueryValue(next, previous) as typeof next).at).toBe(next.at);
});
