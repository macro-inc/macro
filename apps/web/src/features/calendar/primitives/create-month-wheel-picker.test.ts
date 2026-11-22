import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  createMonthWheelPicker,
  MONTH_WHEEL_FIRST_YEAR,
  MONTH_WHEEL_LAST_YEAR,
} from './create-month-wheel-picker';

describe('month wheel session', () => {
  it('commits each column independently without rolling the year with the month', () => {
    createRoot((dispose) => {
      const selected: Date[] = [];
      const picker = createMonthWheelPicker(new Date(2026, 10, 22), (date) =>
        selected.push(date)
      );
      picker.selectMonth(0);
      picker.selectYear(2027);
      expect(picker.month()).toBe(0);
      expect(picker.year()).toBe(2027);
      expect(selected).toEqual([new Date(2026, 0, 1), new Date(2027, 0, 1)]);
      dispose();
    });
  });

  it('keeps the visible week position and bounds the year wheel', () => {
    createRoot((dispose) => {
      const selected: Date[] = [];
      const picker = createMonthWheelPicker(
        new Date(2026, 10, 22),
        (date) => selected.push(date),
        new Date(2026, 10, 15)
      );
      picker.selectMonth(1);
      picker.selectYear(MONTH_WHEEL_FIRST_YEAR - 1);
      picker.selectYear(MONTH_WHEEL_LAST_YEAR + 1);
      expect(selected).toEqual([new Date(2026, 1, 15)]);
      expect(picker.year()).toBe(2026);
      dispose();
    });
  });

  it('keeps a fifth week within a shorter target month', () => {
    createRoot((dispose) => {
      const selected: Date[] = [];
      const picker = createMonthWheelPicker(
        new Date(2026, 9, 31),
        (date) => selected.push(date),
        new Date(2026, 9, 31)
      );
      picker.selectMonth(1);
      expect(selected).toEqual([new Date(2026, 1, 28)]);
      dispose();
    });
  });
  it('resets both columns for Today without applying an intermediate month', () => {
    createRoot((dispose) => {
      const selected: Date[] = [];
      const picker = createMonthWheelPicker(new Date(2026, 10, 22), (date) =>
        selected.push(date)
      );
      picker.resetToToday(new Date(2030, 4, 12));
      expect(picker.month()).toBe(4);
      expect(picker.year()).toBe(2030);
      expect(selected).toEqual([]);
      picker.selectYear(Number.NaN);
      picker.selectMonth(2.5);
      expect(selected).toEqual([]);
      dispose();
    });
  });
});
