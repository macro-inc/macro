export type ClockFormat = '12-hour' | '24-hour';

/** Calendar clocks use compact markers; native hour12 controls keep Intl labels. */
export type ClockDisplayFormat = ClockFormat | boolean;

export const CLOCK_FORMAT_OPTIONS = {
  '12-hour': { hour: 'numeric', minute: '2-digit', hour12: true },
  '24-hour': { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
} satisfies Record<ClockFormat, Intl.DateTimeFormatOptions>;

const CLOCK_FORMATTERS = {
  '12-hour': new Intl.DateTimeFormat(
    undefined,
    CLOCK_FORMAT_OPTIONS['12-hour']
  ),
  '24-hour': new Intl.DateTimeFormat(
    undefined,
    CLOCK_FORMAT_OPTIONS['24-hour']
  ),
};
const NATIVE_CLOCK_FORMATTERS = {
  true: new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }),
  false: new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }),
};
const LOCALE_CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

/** Formats a clock preference without changing the underlying local time. */
export function formatClockTime(
  date: Date,
  format?: ClockDisplayFormat,
  compact = false,
  showDayPeriod = true
): string {
  if (format === undefined) return LOCALE_CLOCK_FORMATTER.format(date);
  if (typeof format === 'boolean')
    return NATIVE_CLOCK_FORMATTERS[format ? 'true' : 'false'].format(date);
  const formatter = CLOCK_FORMATTERS[format];
  if (format === '24-hour') return formatter.format(date);

  const parts = formatter.formatToParts(date);
  const hideMinutes = compact && date.getMinutes() === 0;
  return parts
    .filter((part, index) => {
      if (part.type === 'dayPeriod') return showDayPeriod;
      if (part.type === 'minute') return !hideMinutes;
      if (part.type !== 'literal') return true;
      const next = parts[index + 1];
      const previous = parts[index - 1];
      if (next?.type === 'dayPeriod' || previous?.type === 'dayPeriod') {
        return part.value.trim() !== '';
      }
      return !hideMinutes || next?.type !== 'minute';
    })
    .map((part) =>
      part.type === 'dayPeriod' ? part.value.toLocaleLowerCase() : part.value
    )
    .join('');
}

/** Keeps a shared meridiem only at the end of a compact clock range. */
export function formatClockRange(
  start: Date,
  end: Date,
  format: ClockFormat,
  separator = ' – '
) {
  const startIsMorning = start.getHours() < 12;
  const endIsMorning = end.getHours() < 12;
  const sameDayPeriod = startIsMorning === endIsMorning;
  const showStartDayPeriod = format !== '12-hour' || !sameDayPeriod;
  return `${formatClockTime(start, format, true, showStartDayPeriod)}${separator}${formatClockTime(end, format, true)}`;
}
