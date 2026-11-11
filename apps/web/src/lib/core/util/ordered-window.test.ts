import { expect, it } from 'vitest';
import { preserveOrderedWindow, preservePersonOrder } from './ordered-window';

const row = (id: string, personOrder?: number) => ({ id, personOrder });

it('never leaves an empty row when a windowed identity repeats in the ranked list', () => {
  const a = row('a', 0);
  const duplicate = row('a');
  const b = row('b');

  expect(
    preserveOrderedWindow([a, duplicate, b], [a], (item) => item.id)
  ).toEqual([a, duplicate, b]);
  expect(preservePersonOrder([duplicate, a, b], [a, duplicate, b])).toEqual([
    a,
    a,
    b,
  ]);
});

it('orders people by the window within a tier and lists unranked window people after the last person', () => {
  const first = row('first', 0);
  const second = row('second', 1);
  const third = row('third', 2);
  const unranked = row('unranked', 3);
  const doc = row('doc');
  const tail = row('tail');
  const tiers = new Map([
    ['first', 0],
    ['second', 1],
    ['third', 1],
  ]);

  expect(
    preservePersonOrder(
      [third, doc, second, first, tail],
      [first, second, third, unranked, doc, tail],
      (item) => tiers.get(item.id) ?? 0
    ).map((item) => item.id)
  ).toEqual(['second', 'doc', 'third', 'first', 'unranked', 'tail']);
});
