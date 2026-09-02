import type { DateValue } from '@core/util/date';

export function formatFullDate(date: DateValue): string {
  return new Date(date)
    .toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
    .replace(',', '');
}

export function formatShortDate(date: DateValue): string {
  const d = new Date(date);
  if (d.getFullYear() !== new Date().getFullYear()) {
    return d.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
