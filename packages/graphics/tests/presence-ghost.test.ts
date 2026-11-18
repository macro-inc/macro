import { expect, it } from 'vitest';
import type { PresenceShape } from '../src/loro/presence-state';
import { presenceGhostItem } from '../src/loro/solid/ghost';

const ghost = (shape: Partial<PresenceShape>): PresenceShape => ({
  id: 'ghost',
  kind: 'rectangle',
  width: 100,
  height: 80,
  world: [1, 0, 0, 1, 10, 20],
  ...shape,
});

it('draws a bounds-only ghost that starts at zero size', () => {
  // An AI creation animation's first frame grows a new artifact from 0x0.
  expect(
    presenceGhostItem(ghost({ width: 0, height: 0 }), 'blue')
  ).toMatchObject({
    type: 'rectangle',
    geometry: { width: 0.01, height: 0.01 },
    appearance: { stroke: 'blue' },
  });
});

it('draws a zero-size ghost that carries its item geometry', () => {
  expect(
    presenceGhostItem(
      ghost({
        width: 0,
        height: 0,
        kind: 'ellipse',
        item: {
          type: 'ellipse',
          geometry: JSON.stringify({ width: 0, height: 0 }),
          appearance: { fill: 'red', stroke: 'black' },
        },
      }),
      'blue'
    )
  ).toMatchObject({
    type: 'ellipse',
    geometry: { width: 0.01, height: 0.01 },
  });
});

it('skips a malformed ghost instead of throwing', () => {
  for (const shape of [
    ghost({ width: Number.NaN }),
    ghost({ kind: 'pencil' }),
    ghost({
      item: {
        type: 'rectangle',
        geometry: '{not json',
        appearance: { fill: 'red', stroke: 'black' },
      },
    }),
  ])
    expect(presenceGhostItem(shape, 'blue')).toBeUndefined();
});
