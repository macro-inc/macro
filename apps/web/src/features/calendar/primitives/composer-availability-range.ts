import type { DateTimeRangeValue } from '@app/components/date-time-range/time-range';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import { composerRangeInstants } from './composer-time-zone';

/** Availability reads use exclusive instants and never exceed the API's 370-day bound. */
export function composerAvailabilityRange(
  range: DateTimeRangeValue,
  timeZone: string
) {
  let timed = range;
  if (range.allDay) {
    const end = parseLocalDate(range.end);
    if (!end) return undefined;
    end.setDate(end.getDate() + 1);
    timed = {
      allDay: false,
      start: `${range.start}T00:00`,
      end: `${formatLocalDate(end)}T00:00`,
    };
  }
  const instants = composerRangeInstants(timed, timeZone);
  if (
    !instants ||
    instants.end.getTime() - instants.start.getTime() >
      370 * 24 * 60 * 60 * 1000
  )
    return undefined;
  return instants;
}
