import { deepEqual } from '@core/util/compareUtils';
import { type Accessor, createSignal } from 'solid-js';
import {
  type AvailabilityIssue,
  availabilityTargetIssue,
  rangeOverlaps,
  targetUnavailableWindows,
  targetWindows,
  validAvailabilityDate,
  windowsIssue,
} from '../core/availability';
import {
  type AvailabilityHourRange,
  type AvailabilityHours,
  availabilityHourRanges,
  availabilityHoursFromRanges,
  availabilitySelectedDates,
  commonAvailabilityHours,
  normalizeAvailabilityHours,
  replaceAvailabilityDates,
} from '../core/availability-selection';
import {
  type AvailabilitySchedule,
  MAX_UNAVAILABLE_WINDOWS,
} from '../core/types';

export type AvailabilityRulesDraft =
  | { kind: 'weekly'; day: number; ranges: AvailabilityHourRange[] }
  | {
      kind: 'dates';
      dates: string[];
      ranges: AvailabilityHourRange[] | undefined;
    };

/** Edit whole rules locally; only the parent persists the resulting schedule. */
export function createAvailabilityRules(props: {
  schedule: Accessor<AvailabilitySchedule>;
  disabled: Accessor<boolean>;
  onChange: (
    update: (current: AvailabilitySchedule) => AvailabilitySchedule
  ) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [draft, setDraft] = createSignal<AvailabilityRulesDraft>();
  const [issue, setIssue] = createSignal<AvailabilityIssue>();
  const [notice, setNotice] = createSignal('');
  let initialHours: AvailabilityHours | undefined;

  const hasChanges = () => {
    const current = draft();
    return (
      !!current &&
      !deepEqual(
        current.ranges === undefined
          ? undefined
          : normalizeAvailabilityHours(
              availabilityHoursFromRanges(current.ranges)
            ),
        initialHours
      )
    );
  };
  const close = () => {
    setDraft(undefined);
    initialHours = undefined;
    setIssue(undefined);
    props.onEditingChange?.(false);
  };
  const openWeekday = (day: number) => {
    if (props.disabled() || hasChanges()) return;
    const target = { kind: 'weekly' as const, day };
    const targetIssue = availabilityTargetIssue(props.schedule(), target);
    if (targetIssue) {
      setIssue({ message: targetIssue, mergeable: false });
      return;
    }
    const current = draft();
    if (current?.kind === 'weekly' && current.day === day) return;
    const hours = normalizeAvailabilityHours({
      windows: targetWindows(props.schedule(), target),
      unavailableWindows: targetUnavailableWindows(props.schedule(), target),
    });
    initialHours = hours;
    setDraft({ kind: 'weekly', day, ranges: availabilityHourRanges(hours) });
    setIssue(undefined);
    setNotice('');
    props.onEditingChange?.(true);
  };
  const openDates = (dates: string[]) => {
    if (props.disabled() || hasChanges()) return;
    if (!dates.length || dates.some((date) => !validAvailabilityDate(date))) {
      setIssue({ message: 'Choose valid override dates.', mergeable: false });
      return;
    }
    const selected = [...new Set(dates)].sort();
    const current = draft();
    if (current?.kind === 'dates' && deepEqual(current.dates, selected)) return;
    const hours = commonAvailabilityHours(
      availabilitySelectedDates(props.schedule(), selected)
    );
    initialHours = hours ? normalizeAvailabilityHours(hours) : undefined;
    setDraft({
      kind: 'dates',
      dates: selected,
      ranges: hours ? availabilityHourRanges(hours) : undefined,
    });
    setIssue(undefined);
    setNotice('');
    props.onEditingChange?.(true);
  };
  const update = (ranges: AvailabilityHourRange[]) => {
    if (props.disabled()) return;
    setDraft((current) =>
      current
        ? { ...current, ranges: ranges.map((range) => ({ ...range })) }
        : current
    );
    setIssue(undefined);
    setNotice('');
  };
  const apply = (): boolean => {
    const current = draft();
    if (!current || props.disabled()) return false;
    if (!current.ranges) {
      setIssue({
        message: 'Choose hours for the selected dates.',
        mergeable: false,
      });
      return false;
    }
    const hours = normalizeAvailabilityHours(
      availabilityHoursFromRanges(current.ranges)
    );
    if (current.kind === 'dates') {
      const result = replaceAvailabilityDates(
        props.schedule(),
        current.dates,
        hours
      );
      if (!result.ok) {
        setIssue(result.issue);
        return false;
      }
      props.onChange(() => result.schedule);
    } else {
      const targetIssue = availabilityTargetIssue(props.schedule(), current);
      const hoursIssue =
        windowsIssue(hours.windows) ??
        windowsIssue(hours.unavailableWindows, MAX_UNAVAILABLE_WINDOWS);
      const overlap = hours.windows.some(
        (window) => rangeOverlaps(window, hours.unavailableWindows).length
      );
      const nextIssue = targetIssue
        ? { message: targetIssue, mergeable: false }
        : (hoursIssue ??
          (overlap
            ? {
                message: 'Available hours and time off cannot overlap.',
                mergeable: false,
              }
            : undefined));
      if (nextIssue) {
        setIssue(nextIssue);
        return false;
      }
      props.onChange((schedule) => ({
        ...schedule,
        weekly: schedule.weekly.map((day) =>
          day.day === current.day ? { ...day, ...hours } : day
        ),
      }));
    }
    close();
    setNotice('Availability updated.');
    return true;
  };
  const clearHours = (): boolean => {
    const current = draft();
    if (!current || props.disabled()) return false;
    if (current.kind === 'dates') {
      const result = replaceAvailabilityDates(props.schedule(), current.dates, {
        windows: [],
        unavailableWindows: [],
      });
      if (!result.ok) {
        setIssue(result.issue);
        return false;
      }
      props.onChange(() => result.schedule);
    } else {
      const targetIssue = availabilityTargetIssue(props.schedule(), current);
      if (targetIssue) {
        setIssue({ message: targetIssue, mergeable: false });
        return false;
      }
      props.onChange((schedule) => ({
        ...schedule,
        weekly: schedule.weekly.map((day) =>
          day.day === current.day
            ? { ...day, windows: [], unavailableWindows: [] }
            : day
        ),
      }));
    }
    close();
    setNotice('Hours cleared.');
    return true;
  };
  const removeOverride = (date: string) => {
    if (props.disabled() || hasChanges()) return;
    if (!validAvailabilityDate(date)) {
      setIssue({ message: 'Choose a valid override date.', mergeable: false });
      return;
    }
    props.onChange((schedule) => ({
      ...schedule,
      overrides: schedule.overrides.filter(
        (override) => override.date !== date
      ),
    }));
    if (draft()?.kind === 'dates') close();
    setNotice('Weekly hours restored.');
  };
  const clearAll = () => {
    if (props.disabled()) return;
    props.onChange((schedule) => ({
      ...schedule,
      weekly: schedule.weekly.map((day) => ({
        ...day,
        windows: [],
        unavailableWindows: [],
      })),
      overrides: [],
    }));
    if (draft()) close();
    setNotice('Availability cleared.');
  };
  return {
    draft,
    issue,
    notice,
    hasChanges,
    openWeekday,
    openDates,
    update,
    apply,
    close,
    clearHours,
    removeOverride,
    clearAll,
  };
}
