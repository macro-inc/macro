import { expect, it } from 'vitest';
import { composerAvailabilityRange } from './composer-availability-range';

it('converts inclusive all-day ranges through the selected zone across DST', () => {
  const range = composerAvailabilityRange(
    { allDay: true, start: '2030-03-10', end: '2030-03-10' },
    'America/New_York'
  );
  expect(range?.start.toISOString()).toBe('2030-03-10T05:00:00.000Z');
  expect(range?.end.toISOString()).toBe('2030-03-11T04:00:00.000Z');
});
it('rejects invalid, reversed, and over-limit availability reads', () => {
  expect(
    composerAvailabilityRange(
      { allDay: false, start: '2030-03-10T02:30', end: '2030-03-10T03:30' },
      'America/New_York'
    )
  ).toBeUndefined();
  expect(
    composerAvailabilityRange(
      { allDay: false, start: '2030-01-02T12:00', end: '2030-01-01T12:00' },
      'UTC'
    )
  ).toBeUndefined();
  expect(
    composerAvailabilityRange(
      { allDay: true, start: '2030-01-01', end: '2032-01-01' },
      'UTC'
    )
  ).toBeUndefined();
});
