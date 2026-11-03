import { expect, it } from 'vitest';
import { pollCardHeight } from './poll-card-layout';

it('reserves count-dependent space', () => {
  expect(pollCardHeight({ poll: { optionCount: 2 } })).toBe('17rem');
  expect(pollCardHeight({ poll: { optionCount: 4 } })).toBe('23.5rem');
  expect(pollCardHeight({ poll: { optionCount: 20 } })).toBe('75.5rem');
});

it.each([
  undefined,
  null,
  {},
  { view: { x: 0, y: 0, scale: 1 } },
  { poll: null },
  { poll: { optionCount: '3' } },
  { poll: { optionCount: 1 } },
  { poll: { optionCount: 21 } },
  { poll: { optionCount: 2.5 } },
])('keeps old or invalid preview data compatible: %j', (data) => {
  expect(pollCardHeight(data)).toBeUndefined();
});
