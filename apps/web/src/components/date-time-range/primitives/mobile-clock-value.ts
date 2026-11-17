import { parseTimeValue } from '../time-options';
import type { ClockFormat } from './clock-format';

/** Split display parts so the phone pill can align its meridiem independently. */
export function mobileClockValue(
  value: string,
  format?: ClockFormat,
  locale?: string
) {
  const minutes = parseTimeValue(value);
  if (minutes === undefined) return { time: '', meridiem: '' };
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  };
  if (format === '24-hour') {
    options.hour = '2-digit';
    options.hourCycle = 'h23';
  } else if (format === '12-hour') options.hour12 = true;
  const parts = new Intl.DateTimeFormat(locale, options).formatToParts(date);
  return {
    time: parts
      .filter((part) => part.type !== 'dayPeriod')
      .map((part) => part.value)
      .join('')
      .trim(),
    meridiem:
      parts
        .find((part) => part.type === 'dayPeriod')
        ?.value.toLocaleLowerCase(locale) ?? '',
  };
}
