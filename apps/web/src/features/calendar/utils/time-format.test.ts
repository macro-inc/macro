import { expect, it } from 'vitest';
import { formatCompactCalendarTimeRange } from './time-format';

it('keeps compact event ranges unspaced on both clocks', () => {
  const start = new Date(2030, 0, 1, 14);
  const end = new Date(2030, 0, 1, 16, 30);
  expect(formatCompactCalendarTimeRange(start, end, '12-hour', '–')).toBe(
    '2–4:30pm'
  );
  expect(formatCompactCalendarTimeRange(start, end, '24-hour', '–')).toBe(
    '14:00–16:30'
  );
  expect(
    formatCompactCalendarTimeRange(
      new Date(2030, 0, 1, 11),
      end,
      '12-hour',
      '–'
    )
  ).toBe('11am–4:30pm');
});
