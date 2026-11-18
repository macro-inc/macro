import { expect, it } from 'vitest';
import {
  clipCalendarDisplayRange,
  getCalendarSupportedRange,
} from './calendar-supported-range';

it('keeps supported days when a display window extends past either boundary', () => {
  const now = new Date(2030, 10, 18);
  const bounds = getCalendarSupportedRange(now);
  const first = new Date(bounds.start);
  first.setDate(first.getDate() - 20);
  const last = new Date(bounds.end);
  last.setDate(last.getDate() + 20);
  expect(clipCalendarDisplayRange(first, last, now)).toEqual(bounds);
});
it('does not turn an entirely unsupported window into another date range', () => {
  const now = new Date(2030, 10, 18);
  const bounds = getCalendarSupportedRange(now);
  const last = new Date(bounds.start);
  last.setDate(last.getDate() - 1);
  const first = new Date(last);
  first.setDate(first.getDate() - 42);
  expect(clipCalendarDisplayRange(first, last, now)).toBeUndefined();
});
