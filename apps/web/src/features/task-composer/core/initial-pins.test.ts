import { expect, it } from 'vitest';
import { initialTaskPinDefinitionIds } from './initial-pins';

it('pins visible custom fields without values alongside task defaults', () => {
  const custom = 'empty-custom-definition';
  expect(
    initialTaskPinDefinitionIds(
      [custom, custom, 'unavailable'],
      new Set([custom]),
      ['status', 'status']
    )
  ).toEqual(['status', custom]);
});

it('does not attach hidden tag values or unavailable fields', () => {
  expect(initialTaskPinDefinitionIds([], new Set(), ['status'])).toEqual([
    'status',
  ]);
});
