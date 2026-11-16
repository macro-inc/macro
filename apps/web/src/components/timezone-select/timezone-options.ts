import type { TimezoneOption } from './types';

/** Runtime-supported IANA zones, plus UTC which supportedValuesOf can omit. */
export function timezoneOptions(
  zones: readonly string[] = Intl.supportedValuesOf('timeZone')
): TimezoneOption[] {
  return [...new Set(['UTC', ...zones])].map((value) => ({
    value,
    label: value.replaceAll('_', ' '),
  }));
}
