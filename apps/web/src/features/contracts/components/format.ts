import { formatLocale } from '@app/lib/i18n';

/** "Dec 9" */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

/** "Dec 9, 2026" */
export function formatDayWithYear(iso: string): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

/** "Nov 10, 2:26 PM" */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * "2026-11-09 21:02:11 UTC". The audit certificate prints one fixed form so
 * it reads the same for every party, whatever their language.
 */
export function formatUtc(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Up to two initials for an avatar or an initials field. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}
