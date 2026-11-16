import { describe, expect, it } from 'vitest';
import { formatEventSchedule } from './event-schedule';

describe('event schedule display', () => {
  it('joins a date to a compact clock range', () => {
    expect(
      formatEventSchedule(
        { start: '2030-11-13T14:00', end: '2030-11-13T15:00', allDay: false },
        '12-hour'
      )
    ).toBe('Wed, Nov 13 @ 2 – 3pm');
  });

  it('keeps each date when a timed range crosses midnight', () => {
    expect(
      formatEventSchedule(
        { start: '2030-11-13T22:00', end: '2030-11-14T01:00', allDay: false },
        '24-hour'
      )
    ).toBe('Wed, Nov 13 @ 22:00 – Thu, Nov 14 @ 01:00');
  });

  it('excludes the provider end date for all-day ranges', () => {
    expect(
      formatEventSchedule(
        { start: '2030-11-13', end: '2030-11-14', allDay: true },
        '12-hour'
      )
    ).toBe('Wed, Nov 13 · All day');
    expect(
      formatEventSchedule(
        { start: '2030-11-30', end: '2030-12-03', allDay: true },
        '24-hour'
      )
    ).toBe('Nov 30 – Dec 2 · All day');
  });

  it('preserves an imported point without inventing a duration', () => {
    expect(
      formatEventSchedule(
        { start: '2030-11-13T09:00', end: '2030-11-13T09:00', allDay: false },
        '24-hour'
      )
    ).toBe('Wed, Nov 13 @ 09:00 · No duration');
  });
});
