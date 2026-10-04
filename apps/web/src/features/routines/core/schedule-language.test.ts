import { describe, expect, it } from 'vitest';
import { parseRecurringSchedule } from './schedule-language';

describe('recurring schedule language', () => {
  it.each([
    [
      'every weekday at 9am',
      {
        frequency: 'week',
        time: '09:00',
        daysOfWeek: ['2', '3', '4', '5', '6'],
      },
    ],
    [
      'every Monday at 3:30pm',
      { frequency: 'week', time: '15:30', daysOfWeek: ['2'] },
    ],
    ['daily 14:00', { frequency: 'day', time: '14:00', daysOfWeek: [] }],
    ['every hour', { frequency: 'hour', time: '09:00', daysOfWeek: [] }],
  ])('parses %s', (text, expected) =>
    expect(parseRecurringSchedule(text)).toEqual(expected)
  );
  it.each([
    'every weekday at 25:00',
    'daily at 14pm',
    'tomorrow 9am',
    'every 5 minutes',
    '',
  ])('does not guess unsupported input: %s', (text) =>
    expect(parseRecurringSchedule(text)).toBeUndefined()
  );
});
