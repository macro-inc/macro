import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import type { CalendarPeriodView } from '@app/features/calendar/types';
import { globalSplitManager } from '@app/signal/splitLayout';
import type {
  ReferredFrom,
  SplitContent,
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import {
  CALENDAR_ROUTE_ID,
  CALENDAR_SEARCH_NAMESPACE,
  calendarSearchCodec,
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
  const search = calendarSearchCodec.serialize({ eventId: eventId ?? '' });
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
      route: {
        matches: [{ id: CALENDAR_ROUTE_ID, params: { period } }],
      },
      ...(search ? { search: { [CALENDAR_SEARCH_NAMESPACE]: search } } : {}),
    },
  };
}

/** Open the singleton Calendar route, or retarget its existing split. */
export function openCalendarView(
  target: CalendarRouteTarget = {},
  options: {
    manager?: SplitManager;
    handle?: SplitHandle;
    openInNewSplit?: boolean;
    mergeHistory?: boolean;
    referredFrom?: ReferredFrom;
  } = {}
): void {
  const manager = options.manager ?? globalSplitManager();
  if (!manager) return;

  const content = calendarViewContent(target);
  const existing = manager.getSplitByContent('component', CALENDAR_VIEW_ID);
  if (existing) {
    existing.replace({
      next: content,
      mergeHistory: options.mergeHistory ?? true,
      referredFrom: options.referredFrom,
    });
    existing.activate();
    return;
  }

  manager.openWithSplit(content, {
    activate: true,
    referredFrom: options.referredFrom ?? null,
    preferNewSplit: options.openInNewSplit,
    handle: options.handle,
    mergeHistory: options.mergeHistory,
  });
}
