import { match } from 'ts-pattern';
import { shiftReportDate } from './insights';
import {
  type AvailabilitySchedule,
  MAX_UNAVAILABLE_WINDOWS,
  type TimeWindow,
  validateSchedule,
} from './types';

export type AvailabilityTarget =
  | { kind: 'weekly'; day: number }
  | { kind: 'date'; date: string };
export type AvailabilityState = 'unset' | 'available' | 'unavailable';
export type AvailabilityChange = {
  target: AvailabilityTarget;
  window: TimeWindow;
  mode: 'available' | 'unavailable';
  index?: number;
  allDay?: boolean;
  origin?: { mode: 'available' | 'unavailable'; window: TimeWindow };
};
export type AvailabilityIssue = {
  message: string;
  mergeable: boolean;
  overlaps?: TimeWindow[];
};
export type AvailabilityResult =
  | { ok: true; schedule: AvailabilitySchedule }
  | { ok: false; issue: AvailabilityIssue };

export function timeMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minuteTime(minutes: number): string {
  const value = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function validAvailabilityDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

export function dateWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function availabilityWeek(date: string): string[] {
  const sunday = shiftReportDate(date, -dateWeekday(date));
  return Array.from({ length: 7 }, (_, index) =>
    shiftReportDate(sunday, index)
  );
}

export function windowsIssue(
  windows: TimeWindow[],
  limit = 8
): AvailabilityIssue | undefined {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  if (
    sorted.some(
      (window) =>
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end) ||
        window.start >= window.end
    )
  )
    return {
      message:
        'Each time range must end after it starts. Use separate ranges for overnight hours.',
      mergeable: false,
    };
  if (
    sorted.some(
      (window, index) => index > 0 && sorted[index - 1].end > window.start
    )
  )
    return {
      message:
        'These hours overlap an existing range. Adjust the times or merge the overlapping ranges.',
      mergeable: true,
    };
  if (windows.length > limit)
    return {
      message: `Use at most ${limit} time ranges per day.`,
      mergeable: false,
    };
}

/** Merge only after the user explicitly chooses the overlap fix. */
export function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  const result: TimeWindow[] = [];
  for (const window of [...windows].sort((a, b) =>
    a.start.localeCompare(b.start)
  )) {
    const last = result.at(-1);
    if (last && last.end >= window.start)
      last.end = last.end > window.end ? last.end : window.end;
    else result.push({ ...window });
  }
  return result;
}

/** Intersect a range with valid windows, combining touching intersections. */
export function rangeOverlaps(
  range: TimeWindow,
  windows: readonly TimeWindow[]
): TimeWindow[] {
  if (windowsIssue([range])) return [];
  const intersections = windows.flatMap((window) => {
    if (
      windowsIssue([window]) ||
      range.start >= window.end ||
      range.end <= window.start
    )
      return [];
    return [
      {
        start: range.start > window.start ? range.start : window.start,
        end: range.end < window.end ? range.end : window.end,
      },
    ];
  });
  return mergeWindows(intersections);
}

/** Date overrides store available hours, so time off subtracts from those hours. */
export function subtractWindows(
  windows: TimeWindow[],
  cut: TimeWindow
): TimeWindow[] {
  return windows.flatMap((window) => {
    if (cut.end <= window.start || cut.start >= window.end)
      return [{ ...window }];
    const remaining: TimeWindow[] = [];
    if (cut.start > window.start)
      remaining.push({ start: window.start, end: cut.start });
    if (cut.end < window.end)
      remaining.push({ start: cut.end, end: window.end });
    return remaining;
  });
}

export function targetWindows(
  schedule: AvailabilitySchedule,
  target: AvailabilityTarget
): TimeWindow[] {
  if (target.kind === 'weekly')
    return schedule.weekly.find((day) => day.day === target.day)?.windows ?? [];
  return (
    schedule.overrides.find((override) => override.date === target.date)
      ?.windows ??
    schedule.weekly.find((day) => day.day === dateWeekday(target.date))
      ?.windows ??
    []
  );
}

/** Overrides replace the entire day, so every gap is unavailable, including gaps outside weekly hours. */
export function unavailableWindows(
  schedule: AvailabilitySchedule,
  date: string
): TimeWindow[] {
  const override = schedule.overrides.find((item) => item.date === date);
  if (!override)
    return (
      schedule.weekly.find((day) => day.day === dateWeekday(date))
        ?.unavailableWindows ?? []
    );
  if (override.unavailableWindows != null) return override.unavailableWindows;
  let unavailable: TimeWindow[] = [{ start: '00:00', end: '23:59' }];
  for (const window of override.windows)
    unavailable = subtractWindows(unavailable, window);
  return unavailable;
}

/** Calendar bars show explicit time off, not implicit off-hours. */
export function calendarUnavailableWindows(
  schedule: AvailabilitySchedule,
  date: string,
  previousWindows: TimeWindow[] = []
): TimeWindow[] {
  const override = schedule.overrides.find((item) => item.date === date);
  if (!override)
    return (
      schedule.weekly.find((day) => day.day === dateWeekday(date))
        ?.unavailableWindows ?? []
    );
  if (override.unavailableWindows != null) return override.unavailableWindows;
  if (!override.windows.length) return [{ start: '00:00', end: '23:59' }];

  const weekly = schedule.weekly.find((day) => day.day === dateWeekday(date));
  const candidates = [...(weekly?.windows ?? []), ...previousWindows];
  return mergeWindows(
    unavailableWindows(schedule, date).flatMap((range) =>
      rangeOverlaps(range, candidates)
    )
  );
}

/** A date override replaces both interval sets, including an explicit blank date. */
export function targetUnavailableWindows(
  schedule: AvailabilitySchedule,
  target: AvailabilityTarget,
  legacyDisplayed?: TimeWindow[]
): TimeWindow[] {
  const weekly = schedule.weekly.find(
    (day) =>
      day.day ===
      (target.kind === 'weekly' ? target.day : dateWeekday(target.date))
  );
  const record =
    target.kind === 'date'
      ? (schedule.overrides.find((override) => override.date === target.date) ??
        weekly)
      : weekly;
  if (record?.unavailableWindows != null) return record.unavailableWindows;
  return target.kind === 'weekly'
    ? []
    : (legacyDisplayed ?? calendarUnavailableWindows(schedule, target.date));
}

export function availabilityState(
  schedule: AvailabilitySchedule,
  target: AvailabilityTarget
): AvailabilityState {
  if (targetWindows(schedule, target).length) return 'available';
  return targetUnavailableWindows(schedule, target).length
    ? 'unavailable'
    : 'unset';
}

export function setTargetWindows(
  schedule: AvailabilitySchedule,
  target: AvailabilityTarget,
  windows: TimeWindow[],
  unavailableWindows = targetUnavailableWindows(schedule, target)
): AvailabilitySchedule {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  const unavailable = [...unavailableWindows].sort((a, b) =>
    a.start.localeCompare(b.start)
  );
  if (target.kind === 'weekly')
    return {
      ...schedule,
      weekly: schedule.weekly.map((day) =>
        day.day === target.day
          ? { ...day, windows: sorted, unavailableWindows: unavailable }
          : day
      ),
    };
  const exists = schedule.overrides.some(
    (override) => override.date === target.date
  );
  return {
    ...schedule,
    overrides: exists
      ? schedule.overrides.map((override) =>
          override.date === target.date
            ? { ...override, windows: sorted, unavailableWindows: unavailable }
            : override
        )
      : [
          ...schedule.overrides,
          {
            date: target.date,
            windows: sorted,
            unavailableWindows: unavailable,
          },
        ],
  };
}

/** Clear values without creating time off or deleting a date override. */
export function clearAvailabilityRange(
  schedule: AvailabilitySchedule,
  target: AvailabilityTarget,
  window?: TimeWindow,
  displayedUnavailable = targetUnavailableWindows(schedule, target)
): AvailabilityResult {
  const targetIssue = availabilityTargetIssue(schedule, target);
  if (targetIssue) return availabilityFailure(targetIssue);
  if (window) {
    const issue = windowsIssue([window]);
    if (issue) return { ok: false, issue };
  }
  const windows = window
    ? subtractWindows(targetWindows(schedule, target), window)
    : [];
  const unavailable = window
    ? subtractWindows(
        targetUnavailableWindows(schedule, target, displayedUnavailable),
        window
      )
    : [];
  const issue =
    windowsIssue(windows) ?? windowsIssue(unavailable, MAX_UNAVAILABLE_WINDOWS);
  if (issue) return { ok: false, issue };
  return {
    ok: true,
    schedule: setTargetWindows(schedule, target, windows, unavailable),
  };
}

/** Full-day status changes are drafts; date overrides remain independent of weekly rules. */
export function setAvailabilityState(
  schedule: AvailabilitySchedule,
  target: AvailabilityTarget,
  state: AvailabilityState
): AvailabilityResult {
  const targetIssue = availabilityTargetIssue(schedule, target);
  if (targetIssue) return availabilityFailure(targetIssue);
  const current = targetWindows(schedule, target);
  const rules = match(state)
    .with('unset', () => ({ windows: [], unavailable: [] }))
    .with('unavailable', () => ({
      windows: [],
      unavailable: [{ start: '00:00', end: '23:59' }],
    }))
    .with('available', () => ({
      windows: current.length ? current : [{ start: '09:00', end: '17:00' }],
      unavailable: [],
    }))
    .exhaustive();
  const issue = windowsIssue(rules.windows);
  if (issue) return { ok: false, issue };
  return {
    ok: true,
    schedule: setTargetWindows(
      schedule,
      target,
      rules.windows,
      rules.unavailable
    ),
  };
}

export function availabilityScheduleIssue(
  schedule: AvailabilitySchedule
): string | undefined {
  if (schedule.name.trim().length > 100)
    return 'Use at most 100 characters for the schedule name.';
  if (
    schedule.weekly.length !== 7 ||
    new Set(schedule.weekly.map((day) => day.day)).size !== 7 ||
    schedule.weekly.some(
      (day) => !Number.isInteger(day.day) || day.day < 0 || day.day > 6
    )
  )
    return 'Include each weekday exactly once.';
  if (schedule.overrides.length > 366) return 'Use at most 366 date overrides.';
  if (
    schedule.overrides.some((override) => !validAvailabilityDate(override.date))
  )
    return 'Choose a valid date for every override.';
  for (const day of [...schedule.weekly, ...schedule.overrides]) {
    const issue = windowsIssue(day.windows);
    if (issue) return issue.message;
    const timeOffIssue = windowsIssue(
      day.unavailableWindows ?? [],
      MAX_UNAVAILABLE_WINDOWS
    );
    if (timeOffIssue) return timeOffIssue.message;
    if (
      day.windows.some(
        (window) => rangeOverlaps(window, day.unavailableWindows ?? []).length
      )
    )
      return 'Available hours and time off cannot overlap.';
  }
  return validateSchedule(schedule);
}

export function availabilityTargetIssue(
  schedule: AvailabilitySchedule,
  target: AvailabilityTarget
): string | undefined {
  if (target.kind === 'weekly') {
    if (!Number.isInteger(target.day) || target.day < 0 || target.day > 6)
      return 'Choose a weekday.';
    return;
  }
  if (!validAvailabilityDate(target.date))
    return 'Choose a valid override date.';
  if (
    !schedule.overrides.some((override) => override.date === target.date) &&
    schedule.overrides.length >= 366
  )
    return 'Use at most 366 date overrides. Remove an override before adding another.';
}

function availabilityFailure(message: string): AvailabilityResult {
  return { ok: false, issue: { message, mergeable: false } };
}

const changeWindow = (change: AvailabilityChange): TimeWindow =>
  change.allDay ? { start: '00:00', end: '23:59' } : change.window;
const sameWindow = (a: TimeWindow, b: TimeWindow) =>
  a.start === b.start && a.end === b.end;

/** Editing partial time off replaces that origin; all-day restoration still needs approval. */
export function partialTimeOffOrigin(
  change?: AvailabilityChange
): TimeWindow | undefined {
  const origin = change?.origin;
  if (
    origin?.mode !== 'unavailable' ||
    (origin.window.start === '00:00' && origin.window.end === '23:59')
  )
    return;
  return origin.window;
}

/** Implicit off-hours are not opposing bars; only displayed time off conflicts. */
export function availabilityConflicts(
  schedule: AvailabilitySchedule,
  change: AvailabilityChange,
  unavailable?: TimeWindow[]
): TimeWindow[] {
  const window = changeWindow(change);
  if (windowsIssue([window])) return [];
  if (change.mode === 'unavailable')
    return rangeOverlaps(window, targetWindows(schedule, change.target));
  const opposing = targetUnavailableWindows(
    schedule,
    change.target,
    unavailable
  );
  const origin = partialTimeOffOrigin(change);
  return rangeOverlaps(
    window,
    opposing.filter((range) => !origin || !sameWindow(range, origin))
  );
}

export function availabilityConflictIssue(
  schedule: AvailabilitySchedule,
  change: AvailabilityChange,
  unavailable?: TimeWindow[]
): AvailabilityIssue | undefined {
  const overlaps = availabilityConflicts(schedule, change, unavailable);
  if (!overlaps.length) return;
  const hours = overlaps
    .map((window) => `${window.start}–${window.end}`)
    .join(', ');
  const opposite = change.mode === 'available' ? 'unavailable' : 'available';
  return {
    message: `Currently ${opposite}: ${hours}.`,
    mergeable: false,
    overlaps,
  };
}

function editOriginIssue(
  schedule: AvailabilitySchedule,
  change: AvailabilityChange,
  unavailable: TimeWindow[]
): string | undefined {
  const origin = change.origin;
  if (!origin) return;
  if (windowsIssue([origin.window])) return 'Select a valid range again.';
  const current = targetWindows(schedule, change.target);
  const matches =
    origin.mode === 'available'
      ? change.index !== undefined
        ? current[change.index] &&
          sameWindow(current[change.index], origin.window)
        : current.some((window) => sameWindow(window, origin.window))
      : unavailable.some((window) => sameWindow(window, origin.window));
  if (!matches)
    return 'This range has changed. Select the current range again.';
}

export function applyAvailabilityChange(
  schedule: AvailabilitySchedule,
  change: AvailabilityChange,
  replaceConflicts = false,
  displayedUnavailable?: TimeWindow[]
): AvailabilityResult {
  const target = change.target;
  const targetIssue = availabilityTargetIssue(schedule, target);
  if (targetIssue) return availabilityFailure(targetIssue);
  const window = changeWindow(change);
  const rangeIssue = windowsIssue([window]);
  if (rangeIssue) return { ok: false, issue: rangeIssue };
  const current = targetWindows(schedule, target);
  const invalid = current.map((range) => windowsIssue([range])).find(Boolean);
  if (invalid) return { ok: false, issue: invalid };
  const unavailable = targetUnavailableWindows(
    schedule,
    target,
    displayedUnavailable
  );
  const originIssue = editOriginIssue(schedule, change, unavailable);
  if (originIssue) return availabilityFailure(originIssue);
  const origin = change.origin;
  const editIndex =
    origin?.mode === 'unavailable'
      ? undefined
      : (change.index ??
        (origin?.mode === 'available'
          ? current.findIndex((range) => sameWindow(range, origin.window))
          : undefined));
  if (
    editIndex !== undefined &&
    (!Number.isInteger(editIndex) ||
      editIndex < 0 ||
      editIndex >= current.length)
  )
    return availabilityFailure(
      'This range is no longer available. Select a range again.'
    );
  let windows = current;
  let timeOff = unavailable.filter(
    (range) =>
      origin?.mode !== 'unavailable' || !sameWindow(range, origin.window)
  );
  if (change.mode === 'available') {
    windows = mergeWindows([
      ...windows.filter((_, index) => index !== editIndex),
      window,
    ]);
    timeOff = subtractWindows(timeOff, window);
  } else {
    // Time off removes only the covered hours, even when editing an available range.
    windows = subtractWindows(windows, window);
    timeOff = mergeWindows([...timeOff, window]);
  }
  const issue =
    windowsIssue(windows) ?? windowsIssue(timeOff, MAX_UNAVAILABLE_WINDOWS);
  if (issue) return { ok: false, issue };
  if (!replaceConflicts) {
    const conflict = availabilityConflictIssue(schedule, change, unavailable);
    if (conflict) return { ok: false, issue: conflict };
  }
  return {
    ok: true,
    schedule: setTargetWindows(schedule, target, windows, timeOff),
  };
}

/** Validate every destination before changing any destination. */
export function copyAvailability(
  schedule: AvailabilitySchedule,
  change: AvailabilityChange,
  targets: AvailabilityTarget[],
  replaceConflicts = false,
  unavailableByDate?: ReadonlyMap<string, TimeWindow[]>
): AvailabilityResult {
  let next = schedule;
  const visited = new Set<string>();
  for (const target of targets) {
    const key = target.kind === 'weekly' ? `day:${target.day}` : target.date;
    if (visited.has(key)) continue;
    visited.add(key);
    const result = applyAvailabilityChange(
      next,
      { ...change, target, index: undefined, origin: undefined },
      replaceConflicts,
      target.kind === 'date' ? unavailableByDate?.get(target.date) : undefined
    );
    if (!result.ok) return result;
    next = result.schedule;
  }
  return { ok: true, schedule: next };
}

export const AVAILABILITY_STEP_MINUTES = 5;

/** A pointer selection always covers at least one 5-minute slot. */
export function drawnWindow(anchor: number, position: number): TimeWindow {
  const slot = (minute: number) =>
    Math.max(
      0,
      Math.min(
        1440 - AVAILABILITY_STEP_MINUTES,
        Math.floor(minute / AVAILABILITY_STEP_MINUTES) *
          AVAILABILITY_STEP_MINUTES
      )
    );
  return {
    start: minuteTime(Math.min(slot(anchor), slot(position))),
    end: minuteTime(
      Math.max(slot(anchor), slot(position)) + AVAILABILITY_STEP_MINUTES
    ),
  };
}
