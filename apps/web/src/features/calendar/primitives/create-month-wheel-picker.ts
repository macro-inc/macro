import { createStore } from 'solid-js/store';

// Proposed year bounds; keep the month wheel independent and looping.
export const MONTH_WHEEL_FIRST_YEAR = 1970;
export const MONTH_WHEEL_LAST_YEAR = 2100;

function monthStart(year: number, month: number) {
  const date = new Date(0);
  date.setFullYear(year, month, 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** One open sheet session. Navigation is committed whenever either wheel settles. */
export function createMonthWheelPicker(
  initialDate: Date,
  onSelect: (date: Date) => void,
  weekStart?: Date
) {
  const [state, setState] = createStore({
    month: initialDate.getMonth(),
    year: initialDate.getFullYear(),
  });
  // Preserve the visible week's ordinal when changing months in Week view.
  const weekIndex = weekStart ? Math.floor((weekStart.getDate() - 1) / 7) : 0;

  const apply = (nextMonth: number, nextYear: number) => {
    if (
      !Number.isInteger(nextMonth) ||
      !Number.isInteger(nextYear) ||
      nextMonth < 0 ||
      nextMonth > 11
    )
      return;
    if (nextYear < MONTH_WHEEL_FIRST_YEAR || nextYear > MONTH_WHEEL_LAST_YEAR)
      return;
    const date = monthStart(nextYear, nextMonth);
    if (weekStart) {
      const lastDay = monthStart(nextYear, nextMonth + 1);
      lastDay.setDate(0);
      date.setDate(Math.min(1 + weekIndex * 7, lastDay.getDate()));
    }
    setState({ month: nextMonth, year: nextYear });
    onSelect(date);
  };

  return {
    month: () => state.month,
    year: () => state.year,
    selectMonth: (value: number) => apply(value, state.year),
    selectYear: (value: number) => apply(state.month, value),
    resetToToday: (today = new Date()) =>
      setState({ month: today.getMonth(), year: today.getFullYear() }),
  };
}
