import { parseLocalDate } from '@core/util/local-date';
import { type Accessor, createEffect, on } from 'solid-js';
import { createStore } from 'solid-js/store';

function monthStart(year: number, month: number) {
  const date = new Date(0);
  date.setFullYear(year, month, 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Browsing stays local; only an explicit month or parsed date reaches the host. */
export function createMonthPicker(options: {
  value: Accessor<Date>;
  onChange: (date: Date) => void;
  onGoToDate?: (date: Date) => void;
  today?: Date;
  onReset?: () => void;
}) {
  const today = options.today ?? new Date();
  const initial = options.value();
  const [state, setState] = createStore({
    mode: 'months' as 'months' | 'years',
    year: initial.getFullYear(),
    focusedMonth: initial.getMonth(),
    yearPageStart: initial.getFullYear() - 6,
    focusedYear: initial.getFullYear(),
    dateText: '',
    invalidDate: false,
  });
  createEffect(
    on(
      () => options.value().getTime(),
      () => {
        const value = options.value();
        options.onReset?.();
        setState({
          mode: 'months',
          year: value.getFullYear(),
          focusedMonth: value.getMonth(),
          focusedYear: value.getFullYear(),
          yearPageStart: value.getFullYear() - 6,
          dateText: '',
          invalidDate: false,
        });
      },
      { defer: true }
    )
  );

  const moveFocus = (offset: number) => {
    const date = monthStart(state.year, state.focusedMonth + offset);
    setState({ year: date.getFullYear(), focusedMonth: date.getMonth() });
  };
  const moveYearFocus = (offset: number) => {
    const year = state.focusedYear + offset;
    let start = state.yearPageStart;
    while (year < start) start -= 12;
    while (year > start + 11) start += 12;
    setState({ focusedYear: year, yearPageStart: start });
  };
  const showMonths = () => setState('mode', 'months');
  const toggleYears = () => {
    if (state.mode === 'years') showMonths();
    else
      setState({
        mode: 'years',
        yearPageStart: state.year - 6,
        focusedYear: state.year,
      });
  };
  const chooseYear = (year: number) => setState({ year, mode: 'months' });
  const goToToday = () =>
    setState({
      mode: 'months',
      year: today.getFullYear(),
      focusedMonth: today.getMonth(),
    });
  const submitDate = () => {
    const date = parseLocalDate(state.dateText);
    if (!date) {
      setState('invalidDate', true);
      return;
    }
    options.onGoToDate?.(date);
  };
  return {
    state,
    today,
    chooseMonth: (month: number) =>
      options.onChange(monthStart(state.year, month)),
    moveFocus,
    moveYearFocus,
    toggleYears,
    showMonths,
    chooseYear,
    goToToday,
    todayDisabled: () =>
      state.mode === 'months' && state.year === today.getFullYear(),
    setFocusedMonth: (month: number) => setState('focusedMonth', month),
    setFocusedYear: (year: number) => setState('focusedYear', year),
    changeYear: (offset: number) => setState('year', (year) => year + offset),
    pageYears: (offset: number) =>
      setState({
        yearPageStart: state.yearPageStart + offset * 12,
        focusedYear: state.focusedYear + offset * 12,
      }),
    setDateText: (dateText: string) =>
      setState({ dateText, invalidDate: false }),
    submitDate,
  };
}
