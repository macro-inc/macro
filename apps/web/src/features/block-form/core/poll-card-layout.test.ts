import { expect, it } from 'vitest';
import { pollBodyHeight } from './poll-card-layout';

it('reserves count-dependent space', () => {
  expect(pollBodyHeight({ poll: { optionCount: 2 } })).toBe('13.125rem');
  expect(pollBodyHeight({ poll: { optionCount: 4 } })).toBe('19.625rem');
  expect(pollBodyHeight({ poll: { optionCount: 20 } })).toBe('71.625rem');
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
  expect(pollBodyHeight(data)).toBeUndefined();
});
