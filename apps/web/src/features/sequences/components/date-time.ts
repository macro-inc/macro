import { formatLocale } from '@app/lib/i18n';

const DATE_TIME_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** A server timestamp as a date and time in the interface locale. */
export function formatDateTime(value: string) {
  const locale = formatLocale();
  let format = DATE_TIME_FORMATS.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    DATE_TIME_FORMATS.set(locale, format);
  }
  return format.format(new Date(value));
}
