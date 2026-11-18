import { expect, it } from 'vitest';
import { whenSummary } from './when-summary';

it.each([
  [
    '2030-11-13T13:00',
    '2030-11-13T14:30',
    false,
    '12-hour',
    'Wed, Nov 13 @ 1 – 2:30pm',
  ],
  [
    '2030-11-13T22:00',
    '2030-11-14T01:00',
    false,
    '12-hour',
    'Wed, Nov 13 @ 10pm – Thu, Nov 14 @ 1am',
  ],
  ['2030-11-13', '2030-11-15', true, '12-hour', 'Wed, Nov 13 – Fri, Nov 15'],
  ['2030-11-13', '2030-11-13', true, '12-hour', 'Wed, Nov 13'],
  [
    '2030-11-13T13:00',
    '2030-11-13T14:30',
    false,
    '24-hour',
    'Wed, Nov 13 @ 13:00 – 14:30',
  ],
] as const)('formats %s through %s', (start, end, allDay, clock, expected) => {
  expect(whenSummary(start, end, allDay, clock, 'en-US')).toBe(expected);
});
