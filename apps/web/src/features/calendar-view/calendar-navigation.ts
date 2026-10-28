import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import type { CalendarPeriodView } from '@app/features/calendar/types';
import { paneRoute } from '@app/routes/app-route';
import { globalSplitManager } from '@app/signal/splitLayout';
import type {
  OpenSplitResult,
  ReferredFrom,
  SplitContent,
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import {
  CALENDAR_ROUTE_ID,
  CALENDAR_SEARCH_NAMESPACE,
  calendarSearchCodec,
  calendarTargetSearch,
} from './calendar-url';
import { CALENDAR_VIEW_ID, type CalendarViewTarget } from './types';

let nextFocusRequestId = 1;

export type CalendarRouteTarget = CalendarViewTarget & {
  period?: CalendarPeriodView;
};

/** Route-backed split content for opening or retargeting the Calendar view. */
export function calendarViewContent(
  target: CalendarRouteTarget = {}
): SplitContent {
  const period = target.period ?? getPreferredCalendarPeriodView();
  const eventId =
    typeof target.eventId === 'string' && target.eventId.length > 0
      ? target.eventId
      : undefined;
  const search = calendarSearchCodec.serialize(
    calendarTargetSearch({
      eventId,
      occurrenceKey: target.occurrenceKey,
      range: target.range,
    })
  );
  const params: CalendarViewTarget | undefined = eventId
    ? {
        eventId,
        occurrenceKey: target.occurrenceKey,
        range: target.range,
        focusRequestId: nextFocusRequestId++,
      }
    : undefined;

  return {
    type: 'component',
    id: CALENDAR_VIEW_ID,
    ...(params ? { params: { ...params } } : {}),
    entryMetadata: {
      route: paneRoute({ id: CALENDAR_ROUTE_ID, params: { period } }),
      ...(search ? { search: { [CALENDAR_SEARCH_NAMESPACE]: search } } : {}),
    },
  };
}

/**
 * Open the singleton Calendar route, or retarget its existing split. Returns
 * false when there was nowhere to open it.
 */
export function openCalendarView(
  target: CalendarRouteTarget = {},
  options: {
    manager?: SplitManager;
    handle?: SplitHandle;
    openInNewSplit?: boolean;
    mergeHistory?: boolean;
    referredFrom?: ReferredFrom;
    onApplied?: VoidFunction;
    /** False retargets an open Calendar split without taking focus from the caller. */
    activate?: boolean;
  } = {}
): boolean {
  const manager = options.manager ?? globalSplitManager();
  if (!manager) return false;

  let onApplied = options.onApplied;
  const reportApplied = () => {
    const callback = onApplied;
    onApplied = undefined;
    callback?.();
  };
  const reportImmediateResult = (result: OpenSplitResult | undefined) => {
    if (!result) return;
    if (result.status === 'opened' || result.status === 'reused') {
      reportApplied();
    }
  };

  const content = calendarViewContent(target);
  const existing = manager.getSplitByContent('component', CALENDAR_VIEW_ID);
  if (existing) {
    existing.replace({
      next: content,
      mergeHistory: options.mergeHistory ?? true,
      referredFrom: options.referredFrom,
    });
    if (options.activate !== false) existing.activate();
    reportApplied();
    return true;
  }

  const result = manager.openWithSplit(content, {
    activate: options.activate !== false,
    referredFrom: options.referredFrom ?? null,
    preferNewSplit: options.openInNewSplit,
    handle: options.handle,
    mergeHistory: options.mergeHistory,
    ...(options.onApplied ? { onApplied: reportApplied } : {}),
  });
  reportImmediateResult(result);
  return result !== undefined && result.status !== 'unavailable';
}
