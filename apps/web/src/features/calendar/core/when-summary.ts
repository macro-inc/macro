import {
  type ClockFormat,
  formatClockRange,
  formatClockTime,
} from '@app/components/date-time-range/clock-format';
import { timeRangeFromValue } from '@app/components/date-time-range/time-range';
import { parseLocalDate } from '@core/util/local-date';

export function whenDateLabel(value: string, locale?: string, short = false) {
  const date = parseLocalDate(value.slice(0, 10));
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, {
    weekday: short ? undefined : 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Format wall-clock fields, not instants, so choosing a zone never shifts the label. */
export function whenSummary(
  start: string,
  end: string,
  allDay: boolean,
  format: ClockFormat,
  locale?: string,
  joiner = ' @ '
) {
  const first = whenDateLabel(start, locale);
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  if (allDay)
    return sameDay ? first : `${first} – ${whenDateLabel(end, locale)}`;
  const range = timeRangeFromValue({ start, end, allDay });
  if (!range) return first;
  const { start: from, end: to } = range;
  if (sameDay) return `${first}${joiner}${formatClockRange(from, to, format)}`;
  return `${first}${joiner}${formatClockTime(from, format, true)} – ${whenDateLabel(end, locale)}${joiner}${formatClockTime(to, format, true)}`;
}
