import { formatLocale } from '@app/lib/i18n';
import type { TimezoneOption } from './types';

const cachedOptions = new Map<string, TimezoneOption[]>();

export function shortTimeZoneLabel(
  value: string,
  locale = formatLocale()
): string {
  return (
    new Intl.DateTimeFormat(locale, {
      timeZone: value,
      timeZoneName: 'short',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value ?? value
  );
}

/** Runtime-supported IANA zones, plus UTC which supportedValuesOf can omit. */
export function timezoneOptions(
  zones?: readonly string[],
  locale = formatLocale()
): TimezoneOption[] {
  if (!zones) {
    const cached = cachedOptions.get(locale);
    if (cached) return cached;
  }

  const options = [
    ...new Set(['UTC', ...(zones ?? Intl.supportedValuesOf('timeZone'))]),
  ].map((value) => ({
    value,
    label: value.replaceAll('_', ' '),
    shortName: shortTimeZoneLabel(value, locale),
  }));
  if (!zones) cachedOptions.set(locale, options);
  return options;
}

/** Preserve an imported or retired zone as the selected option. */
export function timezoneOptionsWithCurrent(
  options: TimezoneOption[],
  value: string
): TimezoneOption[] {
  return options.some((option) => option.value === value)
    ? options
    : [{ value, label: value.replaceAll('_', ' ') }, ...options];
}
