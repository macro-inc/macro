import { expect, it } from 'vitest';
import {
  calendarColorHex,
  normalizeCalendarHex,
  parseCalendarColor,
} from './calendar-color';

it.each([
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#000000',
  '#ffffff',
  '#888888',
  '#edc35a',
  '#123456',
])('preserves %s when opening and saving the picker', (hex) => {
  expect(calendarColorHex(parseCalendarColor(hex))).toBe(hex);
});

it('accepts shorthand and pasted hex values but rejects invalid or transparent colors', () => {
  expect(normalizeCalendarHex(' #AbC ')).toBe('#aabbcc');
  expect(normalizeCalendarHex('F49259')).toBe('#f49259');
  for (const value of ['invalid', '#12345', '#12345678', '', 'rgb(1,2,3)']) {
    expect(normalizeCalendarHex(value)).toBeUndefined();
  }
});

it('resolves the computed RGB color used by inherited calendar colors', () => {
  expect(calendarColorHex(parseCalendarColor('rgb(117, 183, 229)'))).toBe(
    '#75b7e5'
  );
});
