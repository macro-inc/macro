import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createMonthPicker } from './create-month-picker';

const TODAY = new Date(2026, 10, 13);
describe('month picker session', () => {
  it('browses without navigating and selects the first day of the chosen month', () => {
    createRoot((dispose) => {
      const onChange = vi.fn();
      const picker = createMonthPicker({
        value: () => TODAY,
        onChange,
        today: TODAY,
      });
      picker.changeYear(1);
      expect(onChange).not.toHaveBeenCalled();
      picker.chooseMonth(1);
      expect(onChange).toHaveBeenCalledWith(new Date(2027, 1, 1));
      dispose();
    });
  });
  it('wraps focus, pages years, and restores months after choosing a year', () => {
    createRoot((dispose) => {
      const picker = createMonthPicker({
        value: () => new Date(2026, 0, 20),
        onChange: vi.fn(),
      });
      picker.moveFocus(-1);
      expect(picker.state.focusedMonth).toBe(11);
      expect(picker.state.year).toBe(2025);
      picker.toggleYears();
      expect(picker.state.yearPageStart).toBe(2019);
      picker.moveYearFocus(6);
      expect(picker.state.yearPageStart).toBe(2031);
      picker.chooseYear(2031);
      expect(picker.state.mode).toBe('months');
      expect(picker.state.year).toBe(2031);
      expect(picker.state.focusedMonth).toBe(11);
      dispose();
    });
  });
  it('returns Today to browsing without selecting or navigating', () => {
    createRoot((dispose) => {
      const onChange = vi.fn();
      const picker = createMonthPicker({
        value: () => new Date(2031, 2, 1),
        onChange,
        today: TODAY,
      });
      expect(picker.todayDisabled()).toBe(false);
      picker.toggleYears();
      picker.goToToday();
      expect(picker.state.mode).toBe('months');
      expect(picker.state.year).toBe(2026);
      expect(picker.state.focusedMonth).toBe(10);
      expect(picker.todayDisabled()).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
      dispose();
    });
  });
  it('retains invalid search text and submits the first valid natural date', () => {
    createRoot((dispose) => {
      const onGoToDate = vi.fn();
      const picker = createMonthPicker({
        value: () => TODAY,
        today: TODAY,
        onChange: vi.fn(),
        onGoToDate,
      });
      picker.setDateText('not a date');
      picker.submitDate();
      expect(picker.state.invalidDate).toBe(true);
      expect(picker.state.dateText).toBe('not a date');
      picker.setDateText('March 12 2031');
      picker.submitDate();
      expect(picker.state.invalidDate).toBe(false);
      expect(onGoToDate).toHaveBeenCalledWith(new Date(2031, 2, 12));
      dispose();
    });
  });
  it('resets inline browsing when the host value changes', async () => {
    let setValue!: (date: Date) => void;
    let picker!: ReturnType<typeof createMonthPicker>;
    const dispose = createRoot((dispose) => {
      const [value, set] = createSignal(TODAY);
      setValue = set;
      picker = createMonthPicker({ value, onChange: vi.fn() });
      return dispose;
    });
    picker.toggleYears();
    setValue(new Date(2034, 5, 1));
    expect(picker.state.mode).toBe('months');
    expect(picker.state.year).toBe(2034);
    expect(picker.state.focusedMonth).toBe(5);
    dispose();
  });
});
