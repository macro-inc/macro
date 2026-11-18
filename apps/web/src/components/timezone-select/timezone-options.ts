import type { TimezoneOption } from './types';

/** Runtime-supported IANA zones, plus UTC which supportedValuesOf can omit. */
export function timezoneOptions(
  zones: readonly string[] = Intl.supportedValuesOf('timeZone')
): TimezoneOption[] {
  return [...new Set(['UTC', ...zones])].map((value) => ({
    value,
    label: value.replaceAll('_', ' '),
    shortName: new Intl.DateTimeFormat(undefined, {
      timeZone: value,
      timeZoneName: 'short',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value,
  }));
}
