import type { DateTimeRangeProps } from '@app/components/date-time-range/date-time-range-context';
import {
  dayTimeOptions,
  endTimeOptions,
  formatDuration,
  splitLocalDateTime,
  type TimeOption,
  withinEndTimeWindow,
  withLocalTime,
} from '@app/components/date-time-range/time-options';
import { beginInteraction } from '@app/observability/flow';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import { differenceInCalendarDays } from 'date-fns';
import { createStore } from 'solid-js/store';

export type WhenPicker =
  | 'when'
  | 'start-date'
  | 'end-date'
  | 'start-time'
  | 'end-time'
  | 'time-zone'
  | 'repeat';

/** One owner for menu exclusion and range edits in both When compositions. */
export function createComposerWhen(options: {
  range: DateTimeRangeProps;
  setRange: (start: string, end: string) => void;
  setAllDay: (value: boolean) => void;
  detailsRevision?: () => number;
}) {
  const [state, setState] = createStore<{
    active?: WhenPicker;
    endChosen: boolean;
    chosenRevision?: number;
  }>({ endChosen: false });
  let cleanup: (() => void) | undefined;
  const close = (picker?: WhenPicker) => {
    if (picker && picker !== state.active) return;
    const previous = cleanup;
    cleanup = undefined;
    setState('active', undefined);
    previous?.();
  };
  const open = (picker: WhenPicker, onClose?: () => void) => {
    if (state.active === picker) return;
    const interaction = beginInteraction('calendar.composer.when.open');
    try {
      const previous = cleanup;
      cleanup = onClose;
      previous?.();
      setState('active', picker);
    } finally {
      interaction.end();
    }
  };
  const toggle = (picker: WhenPicker) =>
    state.active === picker ? close() : open(picker);
  const start = (value: string) => {
    if (options.range.startDisabled) return;
    const range = options.range;
    // Preserve an explicitly chosen end until the new start would invalidate it.
    const invalid = range.allDay ? value > range.end : value >= range.end;
    if (range.endDisabled && invalid) return;
    const endChosen =
      state.endChosen && state.chosenRevision === options.detailsRevision?.();
    if (range.endDisabled || (endChosen && !invalid))
      options.setRange(value, range.end);
    else range.onStartChange(value);
  };
  const end = (value: string) => {
    const range = options.range;
    if (
      range.endDisabled ||
      (range.allDay ? value < range.start : value <= range.start)
    )
      return;
    setState({ endChosen: true, chosenRevision: options.detailsRevision?.() });
    range.onEndChange(value);
  };
  const range = (start: string, end: string) => {
    if (options.range.startDisabled || options.range.endDisabled || end < start)
      return;
    setState({ endChosen: true, chosenRevision: options.detailsRevision?.() });
    options.setRange(start, end);
  };
  const chooseDate = (endpoint: 'start' | 'end', date: Date) => {
    const range = options.range;
    const current = endpoint === 'start' ? range.start : range.end;
    const day = formatLocalDate(date);
    const value = range.allDay
      ? day
      : withLocalTime(day, splitLocalDateTime(current).time);
    if (endpoint === 'start') start(value);
    else end(value);
  };
  const timeOptions = (
    endpoint: 'start' | 'end',
    inline: boolean
  ): TimeOption[] => {
    const range = options.range;
    if (endpoint === 'start') return dayTimeOptions(range.timeFormat);
    const from = splitLocalDateTime(range.start);
    const to = splitLocalDateTime(range.end);
    const fromDate = parseLocalDate(from.date);
    const toDate = parseLocalDate(to.date);
    if (!fromDate || !toDate) return [];
    const days = differenceInCalendarDays(toDate, fromDate);
    if (!inline && withinEndTimeWindow(range.start, range.end))
      return endTimeOptions(from.time, range.timeFormat);
    const startMinutes =
      Number(from.time.slice(0, 2)) * 60 + Number(from.time.slice(3));
    return dayTimeOptions(range.timeFormat).flatMap((option) => {
      const minutes =
        days * 1440 +
        Number(option.value.slice(0, 2)) * 60 +
        Number(option.value.slice(3)) -
        startMinutes;
      return minutes > 0
        ? [
            {
              ...option,
              dayOffset: days,
              id: `${days}|${option.value}`,
              detail: formatDuration(minutes),
            },
          ]
        : [];
    });
  };
  const chooseTime = (endpoint: 'start' | 'end', option: TimeOption) => {
    const range = options.range;
    if (endpoint === 'start') start(withLocalTime(range.start, option.value));
    else {
      const date = parseLocalDate(range.start.slice(0, 10));
      if (!date) return;
      date.setDate(date.getDate() + option.dayOffset);
      end(withLocalTime(formatLocalDate(date), option.value));
    }
  };
  const allDay = (value: boolean) => {
    close();
    setState('endChosen', false);
    options.setAllDay(value);
  };
  return {
    state,
    close,
    open,
    toggle,
    start,
    end,
    range,
    chooseDate,
    timeOptions,
    chooseTime,
    allDay,
  };
}
export type ComposerWhenModel = ReturnType<typeof createComposerWhen>;
