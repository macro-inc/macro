import { parseLocalDate } from '@core/util/local-date';
import { createStore } from 'solid-js/store';

function monthStart(year: number, month: number) {
  const date = new Date(0);
  date.setFullYear(year, month, 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** A picker session owns its browsed year without changing the selected date. */
export function createMonthPicker(
  initialDate: Date,
  onSelect: (date: Date) => void
) {
  const [state, setState] = createStore({
    year: initialDate.getFullYear(),
    focusedMonth: initialDate.getMonth(),
    dateText: '',
    invalidDate: false,
  });

  const chooseMonth = (month: number) => {
    const date = monthStart(state.year, month);
    onSelect(date);
  };

  const moveFocus = (offset: number) => {
    const month = state.focusedMonth + offset;
    const date = monthStart(state.year, month);
    setState({ year: date.getFullYear(), focusedMonth: date.getMonth() });
    return date.getMonth();
  };

  const submitDate = () => {
    const date = parseLocalDate(state.dateText);
    if (!date) {
      setState('invalidDate', true);
      return;
    }
    onSelect(date);
  };

  return {
    state,
    chooseMonth,
    moveFocus,
    setFocusedMonth: (month: number) => setState('focusedMonth', month),
    changeYear: (offset: number) => setState('year', (year) => year + offset),
    setDateText: (text: string) =>
      setState({ dateText: text, invalidDate: false }),
    submitDate,
  };
}
