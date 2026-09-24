import { fetchCalendarMentionPreview } from '@queries/calendar/mention-preview';
import { type Accessor, createSignal } from 'solid-js';
import {
  type CalendarEventTime,
  createCalendarRange,
  isCalendarRange,
} from './calendar-range';
import type { CalendarFocusRequest, CalendarViewTarget } from './types';

/** Builds a request straight from params that already carry a locator range. */
export function targetRequestFromParams(
  params: CalendarViewTarget,
  requestId: number
): CalendarFocusRequest | undefined {
  if (
    typeof params.eventId !== 'string' ||
    params.eventId.length === 0 ||
    !isCalendarRange(params.range)
  ) {
    return undefined;
  }

  return {
    eventId: params.eventId,
    range: params.range,
    occurrenceKey:
      typeof params.occurrenceKey === 'string'
        ? params.occurrenceKey
        : undefined,
    requestId,
    requestedAt: Date.now(),
  };
}

/**
 * A target with an event id but no usable range — a copied `/app/calendar`
 * link or a mention without preview data — resolves through the calendar
 * mention preview API, which also maps another user's projection of the
 * meeting to the viewer's own copy.
 */
export async function resolveTargetRequestFromPreview(
  params: CalendarViewTarget,
  requestId: number
): Promise<CalendarFocusRequest | undefined> {
  if (typeof params.eventId !== 'string' || params.eventId.length === 0) {
    return undefined;
  }
  const occurrenceKey =
    typeof params.occurrenceKey === 'string' ? params.occurrenceKey : undefined;
  const event = await fetchCalendarMentionPreview(
    params.eventId,
    occurrenceKey
  ).catch(() => null);
  // A channel-shared meeting is on none of the viewer's calendars, so there
  // is no event of theirs for the block to focus.
  if (!event?.viewerEventId) return undefined;

  const time: CalendarEventTime =
    event.time.kind === 'timed'
      ? {
          kind: 'timed',
          startsAt: event.time.startsAt,
          endsAt: event.time.endsAt,
        }
      : {
          kind: 'allDay',
          startDate: event.time.startDate,
          endDate: event.time.endDate,
        };
  const range = createCalendarRange(time);
  if (!range) return undefined;

  return {
    eventId: event.viewerEventId,
    range,
    occurrenceKey: event.occurrenceKey ?? occurrenceKey,
    requestId,
    requestedAt: Date.now(),
  };
}

/** The occurrence the block is currently aimed at, and how to re-aim it. */
export interface CalendarTargetAim {
  target: Accessor<CalendarFocusRequest | undefined>;
  aimAt: (params: CalendarViewTarget) => void;
}

/**
 * Tracks the aimed occurrence as a monotonically numbered request.
 *
 * Every aim mints a new request id, including one that lands on the
 * occurrence already targeted. Repeat aims are how a second click on the
 * same mention, soup row or sidebar event pages the calendar back to that
 * event and reopens its details, so treating them as redundant would leave
 * the click with no effect at all beyond activating the split.
 */
export function createCalendarTargetAim(options: {
  initial: CalendarViewTarget;
  resolveFromPreview?: (
    params: CalendarViewTarget,
    requestId: number
  ) => Promise<CalendarFocusRequest | undefined>;
}): CalendarTargetAim {
  const resolveFromPreview =
    options.resolveFromPreview ?? resolveTargetRequestFromPreview;
  let nextRequestId = 1;
  let latestRequestId = 0;
  const [target, setTarget] = createSignal<CalendarFocusRequest | undefined>(
    targetRequestFromParams(options.initial, nextRequestId++)
  );

  // Preview resolution is async, so a stale answer must never clobber a
  // target the user has since re-aimed or cleared. The latest answer always
  // wins, including when it resolves to nothing: a mention whose event was
  // deleted must drop the aim rather than leave the previous event pending
  // for the focus effect to land on.
  const applyResolvedTarget = (
    requestId: number,
    resolved: CalendarFocusRequest | undefined
  ) => {
    if (requestId < latestRequestId) return;
    setTarget(resolved);
  };

  const aimAt = (params: CalendarViewTarget) => {
    const requestId = nextRequestId++;
    latestRequestId = requestId;
    const direct = targetRequestFromParams(params, requestId);
    if (direct) {
      applyResolvedTarget(requestId, direct);
      return;
    }
    if (typeof params.eventId === 'string' && params.eventId.length > 0) {
      resolveFromPreview(params, requestId).then((resolved) => {
        applyResolvedTarget(requestId, resolved);
      });
      return;
    }
    applyResolvedTarget(requestId, undefined);
  };

  if (
    !target() &&
    typeof options.initial.eventId === 'string' &&
    options.initial.eventId
  ) {
    aimAt(options.initial);
  }

  return { target, aimAt };
}
