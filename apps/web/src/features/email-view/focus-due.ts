import { parseLocalDate } from '@core/util/local-date';
import { differenceInCalendarDays, format, isSameYear } from 'date-fns';

type EmailFocusDue = {
  label: string;
  /** The full date, for the tooltip. */
  title: string;
  overdue: boolean;
};

/** A weekday names one day only within the week ahead. */
const DAYS_AS_WEEKDAY = 7;

function daysAhead(due: Date, now: Date): number {
  return differenceInCalendarDays(due, now);
}

function dueLabel(due: Date, now: Date): string {
  const days = daysAhead(due, now);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < DAYS_AS_WEEKDAY) return `Due ${format(due, 'EEE')}`;
  if (isSameYear(due, now)) return `Due ${format(due, 'MMM d')}`;
  return `Due ${format(due, 'MMM d, yyyy')}`;
}

/**
 * How a Focus row shows the day its mail says it is due, against the viewer's
 * local today. `dueOn` is a calendar date, not an instant: `new Date(dueOn)` reads
 * it as midnight UTC, the day before anywhere west of Greenwich. A value this
 * build can't read shows nothing, since the server ships separately.
 */
export function emailFocusDue(
  dueOn: string,
  now: Date
): EmailFocusDue | undefined {
  const due = parseLocalDate(dueOn);
  if (!due) return undefined;

  const fullDate = format(due, 'EEEE, MMMM d, yyyy');
  if (daysAhead(due, now) < 0) {
    return { label: 'Overdue', title: `Was due ${fullDate}`, overdue: true };
  }

  return {
    label: dueLabel(due, now),
    title: `Due ${fullDate}`,
    overdue: false,
  };
}
