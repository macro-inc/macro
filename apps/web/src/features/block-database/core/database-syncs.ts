import { formatLocale } from '@app/lib/i18n';
import type { DatabaseSyncSource } from '@service-cognition/generated/schemas/databaseSyncSource';
import { match } from 'ts-pattern';

/** One string per source, so a database's syncs can tell which sources it already mirrors. */
export function syncSourceKey(source: DatabaseSyncSource): string {
  return match(source)
    .with({ kind: 'granola_meetings' }, () => 'granola')
    .with(
      { kind: 'notion_data_source' },
      (notion) => `notion:${notion.dataSourceId}`
    )
    .exhaustive();
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

/** "5 minutes ago", in the interface language, using the largest whole unit. */
export function formatTimeAgo(at: Date, now: Date): string {
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(formatLocale(), {
    numeric: 'auto',
  });
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return format.format(Math.trunc(seconds / unitSeconds), unit);
    }
  }
  return format.format(0, 'second');
}
