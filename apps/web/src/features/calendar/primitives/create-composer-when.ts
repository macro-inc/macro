import type { DateTimeRangeProps } from '@app/components/date-time-range/date-time-range-context';
import {
  dayTimeOptions,
  endTimeOptions,
  formatDuration,
  parseTimeValue,
  splitLocalDateTime,
  type TimeOption,
  withinEndTimeWindow,
  withLocalTime,
} from '@app/components/date-time-range/time-options';
import { moveTimedRange } from '@app/components/date-time-range/time-range';
import { TIME_WHEEL_MINUTE_STEP } from '@app/components/date-time-range/time-wheel';
import { beginInteraction } from '@app/observability/flow';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import {
  addMinutes,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
} from 'date-fns';
import { createStore } from 'solid-js/store';
import type { PhoneMenuId } from './phone-menu-pattern';

export type WhenPicker =
  | 'when'
  | 'start-date'
  | 'end-date'
  | 'start-time'
  | 'end-time'
  | PhoneMenuId;

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
    timedClock?: { start: string; end: string; revision?: number };
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
  const timeOptions = (endpoint: 'start' | 'end'): TimeOption[] => {
    const range = options.range;
    if (endpoint === 'start') return dayTimeOptions(range.timeFormat);
    const from = splitLocalDateTime(range.start);
    const to = splitLocalDateTime(range.end);
    const fromDate = parseLocalDate(from.date);
    const toDate = parseLocalDate(to.date);
    if (!fromDate || !toDate) return [];
    const days = differenceInCalendarDays(toDate, fromDate);
    if (withinEndTimeWindow(range.start, range.end))
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
  const chooseWheelTime = (endpoint: 'start' | 'end', time: string) => {
    const range = options.range;
    const disabled =
      endpoint === 'start' ? range.startDisabled : range.endDisabled;
    if (range.allDay || disabled || parseTimeValue(time) === undefined) return;
    const currentStart = parseISO(range.start);
    if (!isValid(currentStart)) return;
    const interaction = beginInteraction('calendar.composer.time.select');
    try {
      if (endpoint === 'start') {
        const value = withLocalTime(range.start, time);
        if (range.endDisabled) {
          start(value);
          return;
        }
        // Wheels always move the range, including after an explicit end edit.
        // The shared range arithmetic carries the end date across midnight.
        const next = moveTimedRange(
          { start: range.start, end: range.end },
          value
        );
        options.setRange(next.start, next.end);
        return;
      }
      const value = withLocalTime(range.end, time);
      const minimum = format(
        addMinutes(currentStart, TIME_WHEEL_MINUTE_STEP),
        "yyyy-MM-dd'T'HH:mm"
      );
      end(value < minimum ? minimum : value);
    } finally {
      interaction.end();
    }
  };
  const allDay = (value: boolean) => {
    close();
    if (options.range.allDay === value) return;
    if (value)
      setState('timedClock', {
        start: splitLocalDateTime(options.range.start).time,
        end: splitLocalDateTime(options.range.end).time,
        revision: options.detailsRevision?.(),
      });
    setState('endChosen', false);
    options.setAllDay(value);
    const clock = state.timedClock;
    if (value || !clock || clock.revision !== options.detailsRevision?.())
      return;
    const start = withLocalTime(options.range.start, clock.start);
    const end = withLocalTime(options.range.end, clock.end);
    // A shortened all-day range cannot restore a reversed overnight clock pair.
    if (end > start) options.setRange(start, end);
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
    chooseWheelTime,
    allDay,
  };
}
export type ComposerWhenModel = ReturnType<typeof createComposerWhen>;
