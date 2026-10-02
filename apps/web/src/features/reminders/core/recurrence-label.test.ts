import { expect, it } from 'vitest';
import { describeReminderRecurrence } from './recurrence-label';

it.each([
  ['0 0 9 * * *', 'Repeats daily'],
  ['0 0 9 * * MON-FRI', 'Repeats on weekdays'],
  ['0 0 9 * * 1,7', 'Repeats on weekends'],
  ['0 0 9 * * 2', 'Repeats weekly on Mon'],
  ['0 0 9 15 * *', 'Repeats monthly on the 15th'],
  ['0 0 9 15,1,15 * *', 'Repeats monthly on the 1st and 15th'],
])(
  'describes %s without exposing cron or duplicating its time',
  (cron, cadence) => {
    expect(describeReminderRecurrence(cron)).toEqual({
      cadence,
      time: '9:00 AM',
    });
  }
);

it.each([
  '0 */15 9 * * *',
  '30 0 9 * * *',
  '0 0 9 * * * 2027',
  '0 0 9 1,15 10 *',
  '0 0 9 1,15 * 2',
  '0 99 9 1,15 * *',
  '0 0 9 1,32 * *',
  'invalid',
])('does not invent a recurrence for %s', (cron) => {
  expect(describeReminderRecurrence(cron)).toEqual({
    cadence: 'Repeats on a custom schedule',
  });
});
