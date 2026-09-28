import { tz } from '@date-fns/tz';
import { format, parseISO } from 'date-fns';

/** Calendar dates from the overview are already local `YYYY-MM-DD`. Treat them
 *  as UTC so `date-fns` never applies a second viewer time zone. */
export const OVERVIEW_TZ = tz('UTC');

export function parseOverviewDate(date: string): Date {
  return parseISO(`${date}T00:00:00Z`);
}

export function formatOverviewDate(date: Date): string {
  return format(date, 'yyyy-MM-dd', { in: OVERVIEW_TZ });
}
