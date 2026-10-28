import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { CalendarEvent } from '@service-calendar/generated/schemas/calendarEvent';
import { emailClient } from '@service-email/client';
import type { InvitationResolution } from '@service-email/generated/schemas/invitationResolution';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { copyFailureOutcome } from './copy';
import { calendarKeys } from './keys';
import { invalidateCalendarOccurrences } from './occurrences';

export type CalendarInvitationsData = Record<string, InvitationResolution>;

/** One bounded batch per thread. Snapshot rendering never waits for this query. */
export function useCalendarInvitationsQuery(threadId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: calendarKeys.invitations(threadId()).queryKey,
    queryFn: () =>
      throwOnErr(() => emailClient.getCalendarInvitations(threadId())),
    staleTime: 15_000,
  }));
}
export function invalidateCalendarInvitations() {
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.invitations._def,
  });
}

/** A loaded thread's saved invitations changed: revalidate its calendar state. */
export function invalidateInvitationScheduling(threadId: string) {
  queryClient.invalidateQueries({
    queryKey: calendarKeys.invitations(threadId).queryKey,
  });
}

/** Non-suspending fallback after a background refresh fails. */
export function getCachedCalendarInvitations(threadId: string) {
  return queryClient.getQueryData<CalendarInvitationsData>(
    calendarKeys.invitations(threadId).queryKey
  );
}

export interface CopyCalendarInvitationArgs {
  threadId: string;
  /** Message the shared event arrived in. */
  messageId: string;
  /** Saved event within that message. */
  invitationId: string;
  /** Google calendar to add the copy to; omit for the primary calendar. */
  calendarId?: string;
}

async function copyCalendarInvitation(
  args: CopyCalendarInvitationArgs
): Promise<CalendarEvent> {
  return Telemetry.span('calendar.copy_email_event', async (span) => {
    span.setAttr('email.thread_id', args.threadId);
    span.setAttr('email.message_id', args.messageId);
    span.setAttr(
      'calendar.copy.picked_calendar',
      args.calendarId !== undefined
    );
    try {
      const copy = await throwOnErr(() =>
        emailClient.copyCalendarInvitation(args, {
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

/**
 * Adds a snapshot of an event someone shared by email (a published .ics) to
 * one of the viewer's Google calendars, the way Add to calendar adds a
 * channel-shared event. Once it lands, the thread's invitation resolves to it.
 */
export function useCopyCalendarInvitationMutation(
  callbacks?: MutationCallbacks<
    CalendarEvent,
    Error,
    CopyCalendarInvitationArgs,
    unknown
  >
) {
  return useMutation(() => ({
    mutationFn: copyCalendarInvitation,
    ...withCallbacks<CalendarEvent, Error, CopyCalendarInvitationArgs>(
      {
        // A copy that Google already held is synced in by the server, so the
        // card refreshes either way.
        onSettled: (_data, _error, args) => {
          invalidateInvitationScheduling(args.threadId);
          return invalidateCalendarOccurrences();
        },
      },
      callbacks
    ),
  }));
}
