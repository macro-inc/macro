import {
  AVAILABILITY_STEP_MINUTES,
  type AvailabilityChange,
  mergeWindows,
  minuteTime,
  partialTimeOffOrigin,
  rangeOverlaps,
  timeMinutes,
} from './availability';
import type { TimeWindow } from './types';

export type AvailabilityBar = {
  window: TimeWindow;
  index?: number;
  draft: boolean;
  overlaps: TimeWindow[];
};

const sameWindow = (a: TimeWindow, b: TimeWindow) =>
  a.start === b.start && a.end === b.end;

/** Show one connected bar per type and mark only pending opposite-type changes. */
export function availabilityBars(
  available: TimeWindow[],
  unavailable: TimeWindow[],
  change?: AvailabilityChange,
  active = true
): { available: AvailabilityBar[]; unavailable: AvailabilityBar[] } {
  const effective = active ? available : [];
  const unavailableOrigin = partialTimeOffOrigin(change);
  const opposingUnavailable = unavailable.filter(
    (window) => !unavailableOrigin || !sameWindow(window, unavailableOrigin)
  );
  const conflicts = change
    ? rangeOverlaps(
        change.window,
        change.mode === 'available' ? opposingUnavailable : effective
      )
    : [];
  let nextAvailable = available;
  let nextUnavailable = unavailable;
  if (change?.mode === 'available') {
    const remaining = effective.filter(
      (_, index) =>
        change.origin?.mode !== 'available' || index !== change.index
    );
    nextAvailable = mergeWindows([...remaining, change.window]);
    if (change.origin?.mode === 'unavailable')
      nextUnavailable = unavailable.filter(
        (window) => !sameWindow(window, change.origin!.window)
      );
  } else if (change?.mode === 'unavailable') {
    nextUnavailable = mergeWindows([
      ...unavailable.filter(
        (window) =>
          change.origin?.mode !== 'unavailable' ||
          !sameWindow(window, change.origin.window)
      ),
      change.window,
    ]);
    nextAvailable = effective;
  }
  const bars = (windows: TimeWindow[], mode: AvailabilityChange['mode']) =>
    mergeWindows(windows).map((window): AvailabilityBar => {
      const draft =
        change?.mode === mode &&
        window.start <= change.window.start &&
        window.end >= change.window.end;
      const index = available.findIndex((source) => sameWindow(source, window));
      return {
        window,
        index: mode === 'available' && index >= 0 ? index : undefined,
        draft,
        overlaps: rangeOverlaps(window, conflicts),
      };
    });
  return {
    available: bars(nextAvailable, 'available'),
    unavailable: bars(nextUnavailable, 'unavailable'),
  };
}

/** Move within one day, preserving duration and snapping the start to 5 minutes. */
export function movedAvailabilityWindow(
  window: TimeWindow,
  delta: number
): TimeWindow {
  const start = timeMinutes(window.start);
  const duration = timeMinutes(window.end) - start;
  const next = Math.max(
    0,
    Math.min(
      1439 - duration,
      Math.round((start + delta) / AVAILABILITY_STEP_MINUTES) *
        AVAILABILITY_STEP_MINUTES
    )
  );
  return { start: minuteTime(next), end: minuteTime(next + duration) };
}
