import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { CalendarEvent } from '@service-calendar/generated/schemas/calendarEvent';
import { CalendarMutationErrorCode } from '@service-calendar/generated/schemas/calendarMutationErrorCode';
import { emailClient } from '@service-email/client';
import { useMutation } from '@tanstack/solid-query';
import { invalidateCalendarEventPreviews } from './mention-preview';
import { invalidateCalendarOccurrences } from './occurrences';

export interface CopySharedCalendarEventArgs {
  /** The channel-shared event the mention names. */
  eventId: string;
  /** Google calendar to add the copy to; omit for the primary calendar. */
  calendarId?: string;
}

/** Whether the meeting turned out to be on one of the viewer's calendars. */
export function isAlreadyOnCalendar(error: unknown): boolean {
  return thrownResultErrorHasCode(
    error,
    CalendarMutationErrorCode.already_on_calendar
  );
}

/**
 * Whether the viewer's request to join the event is pending or accepted, so
 * the meeting reaches their calendar as an invitation instead of a copy.
 */
export function isJoinRequestOpen(error: unknown): boolean {
  return thrownResultErrorHasCode(
    error,
    CalendarMutationErrorCode.join_request_open
  );
}

/** Whether Google refused to add the copy to the picked calendar. */
export function isCopyRefused(error: unknown): boolean {
  return thrownResultErrorHasCode(
    error,
    CalendarMutationErrorCode.copy_refused
  );
}

function copyFailureOutcome(error: unknown) {
  if (isAlreadyOnCalendar(error)) return 'already_on_calendar';
  if (isJoinRequestOpen(error)) return 'join_request_open';
  if (isCopyRefused(error)) return 'copy_refused';
  return 'failed';
}

async function copySharedCalendarEvent(
  args: CopySharedCalendarEventArgs
): Promise<CalendarEvent> {
  return Telemetry.span('calendar.copy_shared_event', async (span) => {
    span.setAttr('calendar.event_id', args.eventId);
    span.setAttr(
      'calendar.copy.picked_calendar',
      args.calendarId !== undefined
    );
    try {
      const copy = await throwOnErr(() =>
        emailClient.copyCalendarEvent(args.eventId, {
          calendarId: args.calendarId,
        })
      );
      span.setAttr('calendar.copy.event_id', copy.id);
      span.setAttr('calendar.copy.outcome', 'copied');
      return copy;
    } catch (error) {
      const outcome = copyFailureOutcome(error);
      span.setAttr('calendar.copy.outcome', outcome);
      span.error(
        outcome === 'already_on_calendar'
          ? 'Event already on a calendar'
          : 'Adding the event failed'
      );
      throw error;
    }
  });
}

type CopyCallbacks = MutationCallbacks<
  CalendarEvent,
  Error,
  CopySharedCalendarEventArgs,
  unknown
>;

/**
 * Adds a snapshot of an event shared with one of the viewer's channels to
 * one of their Google calendars. The snapshot keeps the meeting's iCalendar
 * UID, so once it lands the mention preview resolves to it and the chip
 * opens it.
 */
export function useCopySharedCalendarEventMutation(callbacks?: CopyCallbacks) {
  return useMutation(() => ({
    mutationFn: copySharedCalendarEvent,
    ...withCallbacks<CalendarEvent, Error, CopySharedCalendarEventArgs>(
      {
        // A copy that Google already held is synced in by the server, so the
        // preview refreshes either way.
        onSettled: (_data, _error, args) => {
          invalidateCalendarEventPreviews(args.eventId);
          return invalidateCalendarOccurrences();
        },
      },
      callbacks
    ),
  }));
}
