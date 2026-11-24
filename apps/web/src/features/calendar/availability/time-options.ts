import { formatLocale } from '@app/lib/i18n';
import type { CalendarTimeFormat } from '../types';

/** Half-hour choices between local hours, including either boundary. */
export function availabilityTimeOptions(
  fromHour: number,
  toHour: number,
  format?: CalendarTimeFormat
) {
  const formatter = new Intl.DateTimeFormat(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    ...(format ? { hour12: format === '12-hour' } : {}),
  });
  const options: { value: string; label: string }[] = [];
  for (let minutes = fromHour * 60; minutes <= toHour * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    options.push({
      value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      label: formatter.format(new Date(2000, 0, 1, hour, minute)),
    });
  }
  return options;
}
