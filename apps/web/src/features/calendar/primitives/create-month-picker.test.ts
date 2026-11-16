import { describe, expect, it } from 'vitest';
import { createMonthPicker } from './create-month-picker';

describe('month picker session', () => {
  it('browses years without navigating and selects the first day of the chosen month', () => {
    const selected: Date[] = [];
    const picker = createMonthPicker(new Date(2026, 10, 30), (date) =>
      selected.push(date)
    );
    picker.changeYear(1);
    expect(selected).toHaveLength(0);
    picker.chooseMonth(1);
    expect(selected).toEqual([new Date(2027, 1, 1)]);
  });

  it('moves keyboard focus across years without selecting a date', () => {
    const selected: Date[] = [];
    const picker = createMonthPicker(new Date(2026, 0, 20), (date) =>
      selected.push(date)
    );
    expect(picker.moveFocus(-1)).toBe(11);
    expect(picker.state.year).toBe(2025);
    expect(picker.moveFocus(4)).toBe(3);
    expect(picker.state.year).toBe(2026);
    expect(selected).toHaveLength(0);
  });

  it('rejects impossible dates and clears validation on a new draft', () => {
    const selected: Date[] = [];
    const picker = createMonthPicker(new Date(2026, 0, 20), (date) =>
      selected.push(date)
    );
    picker.setDateText('2026-02-30');
    picker.submitDate();
    expect(picker.state.invalidDate).toBe(true);
    expect(selected).toHaveLength(0);
    picker.setDateText('2028-02-29');
    expect(picker.state.invalidDate).toBe(false);
    picker.submitDate();
    expect(selected).toEqual([new Date(2028, 1, 29)]);
  });
});
