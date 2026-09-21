import { addDays, format } from 'date-fns';
import { formatOverviewDate, parseOverviewDate } from './activity-dates';
import type { ActivityOverview } from './event';

/** Days in the server's trailing-year overview window. */
const WINDOW_DAYS = 365;

/**
 * An empty overview spanning the same window the server will return: the
 * 365 local dates ending after the viewer's current date. Feeding it to the
 * graph while the real overview loads yields the exact final geometry, so
 * the skeleton cannot drift from the ready card.
 */
export function placeholderOverview(now: Date): ActivityOverview {
  const today = parseOverviewDate(format(now, 'yyyy-MM-dd'));
  const to = addDays(today, 1);
  const from = addDays(to, -WINDOW_DAYS);
  return {
    from: formatOverviewDate(from),
    to: formatOverviewDate(to),
    timeZone: 'UTC',
    total: 0,
    days: [],
    topEntities: [],
  };
}
