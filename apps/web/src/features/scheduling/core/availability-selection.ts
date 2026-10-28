import {
  type AvailabilityChange,
  type AvailabilityResult,
  type AvailabilityTarget,
  minuteTime,
  rangeOverlaps,
  targetUnavailableWindows,
  targetWindows,
  timeMinutes,
  validAvailabilityDate,
  windowsIssue,
} from './availability';
import {
  type AvailabilitySchedule,
  MAX_UNAVAILABLE_WINDOWS,
  type TimeWindow,
} from './types';

export type AvailabilityHours = {
  windows: TimeWindow[];
  unavailableWindows: TimeWindow[];
};

export type AvailabilityHourRange = TimeWindow & {
  mode: AvailabilityChange['mode'];
  /** Preserve the timed range while the editor temporarily marks it all-day. */
  allDay?: boolean;
};

/** Keep one editable list while storing available hours and time off separately. */
export function availabilityHourRanges(
  hours: AvailabilityHours
): AvailabilityHourRange[] {
  return [
    ...hours.windows.map((window) => ({
      ...window,
      mode: 'available' as const,
      allDay: window.start === '00:00' && window.end === '23:59',
    })),
    ...hours.unavailableWindows.map((window) => ({
      ...window,
      mode: 'unavailable' as const,
      allDay: window.start === '00:00' && window.end === '23:59',
    })),
  ].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
  );
}

export function availabilityHoursFromRanges(
  ranges: AvailabilityHourRange[]
): AvailabilityHours {
  const window = ({ start, end, allDay }: AvailabilityHourRange): TimeWindow =>
    allDay ? { start: '00:00', end: '23:59' } : { start, end };
  return {
    windows: ranges.filter((range) => range.mode === 'available').map(window),
    unavailableWindows: ranges
      .filter((range) => range.mode === 'unavailable')
      .map(window),
  };
}

/** Append a full hour without wrapping overnight or overlapping an all-day range. */
export function nextAvailabilityHourRange(
  ranges: AvailabilityHourRange[]
): AvailabilityHourRange | undefined {
  if (
    ranges.some((range) => range.allDay) ||
    ranges.length >= 8 + MAX_UNAVAILABLE_WINDOWS
  )
    return;
  const last = ranges.at(-1);
  if (last && windowsIssue([last])) return;
  const start = last ? timeMinutes(last.end) : 9 * 60;
  if (start + 60 > 1439) return;
  return {
    mode:
      ranges.filter((range) => range.mode === 'available').length < 8
        ? 'available'
        : 'unavailable',
    start: minuteTime(start),
    end: minuteTime(start + 60),
  };
}

export type AvailabilitySelectedDate = {
  date: string;
  hours: AvailabilityHours;
  overridden: boolean;
};

const sortedDates = (dates: string[]) => [...new Set(dates)].sort();

/** Normalize interval order and detach the hours from the schedule or caller. */
export function normalizeAvailabilityHours(
  hours: AvailabilityHours
): AvailabilityHours {
  const sorted = (windows: TimeWindow[]) =>
    windows
      .map((window) => ({ ...window }))
      .sort(
        (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
      );
  return {
    windows: sorted(hours.windows),
    unavailableWindows: sorted(hours.unavailableWindows),
  };
}

/** Edit stored hours, not the implicit gaps around a legacy timed override. */
export function availabilityRuleHours(
  schedule: AvailabilitySchedule,
  target: AvailabilityTarget
): AvailabilityHours {
  const override =
    target.kind === 'date'
      ? schedule.overrides.find((entry) => entry.date === target.date)
      : undefined;
  const legacyTimedOverride =
    override &&
    override.windows.length > 0 &&
    override.unavailableWindows == null;
  return {
    windows: targetWindows(schedule, target),
    // A legacy empty override still means all-day time off, not a blank date.
    unavailableWindows: legacyTimedOverride
      ? []
      : targetUnavailableWindows(schedule, target),
  };
}
export function availabilitySelectedDates(
  schedule: AvailabilitySchedule,
  dates: string[]
): AvailabilitySelectedDate[] {
  return sortedDates(dates).map((date) => {
    const target = { kind: 'date' as const, date };
    return {
      date,
      hours: normalizeAvailabilityHours(
        availabilityRuleHours(schedule, target)
      ),
      overridden: schedule.overrides.some((override) => override.date === date),
    };
  });
}

/** Mixed hours have no shared editable value. */
export function commonAvailabilityHours(
  selectedDates: AvailabilitySelectedDate[]
): AvailabilityHours | undefined {
  const first = selectedDates[0];
  if (!first) return;
  const hours = normalizeAvailabilityHours(first.hours);
  const sameWindows = (a: TimeWindow[], b: TimeWindow[]) =>
    a.length === b.length &&
    a.every(
      (window, index) =>
        window.start === b[index].start && window.end === b[index].end
    );
  if (
    selectedDates.some((selected) => {
      const other = normalizeAvailabilityHours(selected.hours);
      return (
        !sameWindows(hours.windows, other.windows) ||
        !sameWindows(hours.unavailableWindows, other.unavailableWindows)
      );
    })
  )
    return;
  return hours;
}

/** Replace all selected dates together, or leave the original schedule untouched. */
export function replaceAvailabilityDates(
  schedule: AvailabilitySchedule,
  dates: string[],
  hours: AvailabilityHours
): AvailabilityResult {
  const selected = sortedDates(dates);
  if (selected.some((date) => !validAvailabilityDate(date)))
    return {
      ok: false,
      issue: { message: 'Choose a valid override date.', mergeable: false },
    };
  const normalized = normalizeAvailabilityHours(hours);
  const issue =
    windowsIssue(normalized.windows) ??
    windowsIssue(normalized.unavailableWindows, MAX_UNAVAILABLE_WINDOWS);
  if (issue) return { ok: false, issue };
  if (
    normalized.windows.some(
      (window) => rangeOverlaps(window, normalized.unavailableWindows).length
    )
  )
    return {
      ok: false,
      issue: {
        message: 'Available hours and time off cannot overlap.',
        mergeable: false,
      },
    };
  const existing = new Set(schedule.overrides.map((override) => override.date));
  if (
    schedule.overrides.length +
      selected.filter((date) => !existing.has(date)).length >
    366
  )
    return {
      ok: false,
      issue: { message: 'Use at most 366 date overrides.', mergeable: false },
    };

  const replacements = new Map(
    selected.map((date) => [date, normalizeAvailabilityHours(normalized)])
  );
  const next: AvailabilitySchedule = {
    ...schedule,
    overrides: [
      ...schedule.overrides.map((override) => {
        const replacement = replacements.get(override.date);
        return replacement ? { ...override, ...replacement } : override;
      }),
      ...selected
        .filter((date) => !existing.has(date))
        .map((date) => ({ date, ...normalizeAvailabilityHours(normalized) })),
    ],
  };
  return { ok: true, schedule: next };
}
