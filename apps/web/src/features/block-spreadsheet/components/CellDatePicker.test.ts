import { describe, expect, it } from 'vitest';
import { datePickerKeyDay } from './CellDatePicker';

const key = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, ...init });

describe('date picker keys', () => {
  it('moves by a day with left and right, and a week with up and down', () => {
    const day = new Date(2026, 9, 31);
    expect(datePickerKeyDay(key('ArrowLeft'), day)).toEqual(
      new Date(2026, 9, 30)
    );
    expect(datePickerKeyDay(key('ArrowRight'), day)).toEqual(
      new Date(2026, 10, 1)
    );
    expect(datePickerKeyDay(key('ArrowUp'), day)).toEqual(
      new Date(2026, 9, 24)
    );
    expect(datePickerKeyDay(key('ArrowDown'), day)).toEqual(
      new Date(2026, 10, 7)
    );
  });

  it('moves by a month or a year to the same day, or the last of a shorter month', () => {
    expect(datePickerKeyDay(key('PageDown'), new Date(2026, 0, 31))).toEqual(
      new Date(2026, 1, 28)
    );
    expect(datePickerKeyDay(key('PageUp'), new Date(2026, 2, 15))).toEqual(
      new Date(2026, 1, 15)
    );
    expect(
      datePickerKeyDay(key('PageUp', { shiftKey: true }), new Date(2028, 1, 29))
    ).toEqual(new Date(2027, 1, 28));
    expect(
      datePickerKeyDay(
        key('PageDown', { shiftKey: true }),
        new Date(2026, 11, 31)
      )
    ).toEqual(new Date(2027, 11, 31));
  });

  it('leaves modified arrows and other keys to the editor', () => {
    const day = new Date(2026, 9, 16);
    expect(
      datePickerKeyDay(key('ArrowLeft', { shiftKey: true }), day)
    ).toBeUndefined();
    expect(
      datePickerKeyDay(key('ArrowRight', { metaKey: true }), day)
    ).toBeUndefined();
    expect(
      datePickerKeyDay(key('ArrowDown', { altKey: true }), day)
    ).toBeUndefined();
    expect(datePickerKeyDay(key('Home'), day)).toBeUndefined();
    expect(datePickerKeyDay(key('1'), day)).toBeUndefined();
  });
});
