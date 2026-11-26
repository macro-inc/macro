import type { ClockFormat } from './clock-format';
import { parseTimeValue } from './time-options';

/** Split display parts so a clock field can align its meridiem independently. */
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

/** Keep the numeric entry and trailing period in separate columns while editing. */
export function editableClockValue(
  value: string,
  text: string | undefined,
  matchedValue: string | undefined,
  format?: ClockFormat,
  locale?: string
) {
  const display = mobileClockValue(matchedValue ?? value, format, locale);
  if (text === undefined) return display;
  const suffix = /^(\d[\d: h]*?)\s*(am?|pm?)$/i.exec(text.trim());
  return {
    time: suffix ? suffix[1].trim() : text,
    meridiem: suffix
      ? suffix[2].toLowerCase().startsWith('p')
        ? 'pm'
        : 'am'
      : /^\d{2}/.test(text) && Number(text.slice(0, 2)) > 12
        ? ''
        : display.meridiem,
  };
}
