import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { CalendarJoinRequestDecision } from '@service-calendar/generated/schemas/calendarJoinRequestDecision';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarJoinRequest } from '@service-storage/generated/schemas/calendarJoinRequest';
import { CalendarJoinRequestErrorCode } from '@service-storage/generated/schemas/calendarJoinRequestErrorCode';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys } from './keys';
import { invalidateCalendarEventPreviews } from './mention-preview';
import { invalidateCalendarOccurrences } from './occurrences';

export type { CalendarJoinRequest };

function joinRequestsQueryOptions(eventId: string, enabled: boolean) {
  return {
    queryKey: calendarKeys.joinRequests(eventId).queryKey,
    queryFn: async () =>
      (
        await throwOnErr(() =>
          storageServiceClient.listCalendarEventJoinRequests(eventId)
        )
      ).requests,
    enabled,
    staleTime: 30_000,
  };
}

/**
 * Pending requests to join an event the viewer can change, oldest first.
 */
export function useCalendarJoinRequestsQuery(
  eventId: Accessor<string>,
  options: Accessor<{ enabled: boolean }>
) {
  return useQuery(() => joinRequestsQueryOptions(eventId(), options().enabled));
}

/** Whether the person who shared the event cannot add guests to it. */
export function isSharerCannotInvite(error: unknown): boolean {
  return thrownResultErrorHasCode(
    error,
    CalendarJoinRequestErrorCode.sharer_cannot_invite
  );
}

/** Whether the person who shared the event declined the viewer's request. */
export function isJoinRequestDeclined(error: unknown): boolean {
  return thrownResultErrorHasCode(
    error,
    CalendarJoinRequestErrorCode.request_declined
  );
}

async function requestToJoinCalendarEvent(
  eventId: string
): Promise<CalendarJoinRequest> {
  return Telemetry.span('calendar.request_to_join', async (span) => {
    span.setAttr('calendar.event_id', eventId);
    try {
      const request = await throwOnErr(() =>
        storageServiceClient.requestToJoinCalendarEvent(eventId)
      );
      span.setAttr('calendar.join_request.id', request.id);
      span.setAttr('calendar.join_request.outcome', 'requested');
      return request;
    } catch (error) {
      const outcome = isSharerCannotInvite(error)
        ? 'sharer_cannot_invite'
        : isJoinRequestDeclined(error)
          ? 'declined'
          : 'failed';
      span.setAttr('calendar.join_request.outcome', outcome);
      span.error(
        outcome === 'failed' ? 'Join request failed' : 'Join request refused'
      );
      throw error;
    }
  });
}

/**
 * Asks the person who shared an event with one of the viewer's channels to
 * add them as a guest. The mention preview carries the request's status, so
 * it is refetched to show the request as sent.
 */
export function useRequestToJoinCalendarEventMutation(
  callbacks?: MutationCallbacks<CalendarJoinRequest, Error, string, unknown>
) {
  return useMutation(() => ({
    mutationFn: requestToJoinCalendarEvent,
    ...withCallbacks<CalendarJoinRequest, Error, string>(
      {
        onSettled: (_data, _error, eventId) =>
          invalidateCalendarEventPreviews(eventId),
      },
      callbacks
    ),
  }));
}

export type RespondToCalendarJoinRequestArgs = {
  request: CalendarJoinRequest;
  decision: CalendarJoinRequestDecision;
};

async function respondToCalendarJoinRequest({
  request,
  decision,
}: RespondToCalendarJoinRequestArgs): Promise<CalendarJoinRequest> {
  return Telemetry.span('calendar.respond_to_join_request', async (span) => {
    span.setAttr('calendar.event_id', request.eventId);
    span.setAttr('calendar.join_request.id', request.id);
    span.setAttr('calendar.join_request.decision', decision);
    try {
      const answered = await throwOnErr(() =>
        emailClient.respondToCalendarJoinRequest(request.id, { decision })
      );
      span.setAttr('calendar.join_request.outcome', answered.status);
      return answered;
    } catch (error) {
      span.setAttr('calendar.join_request.outcome', 'failed');
      // Provider messages can quote addresses; record only the category.
      span.error('Answering the join request failed');
      throw error;
    }
  });
}

/**
 * Answers a join request on an event the viewer can change. Accepting adds
 * the requester as a guest, so the event's occurrences are refetched too.
 */
export function useRespondToCalendarJoinRequestMutation(
  callbacks?: MutationCallbacks<
    CalendarJoinRequest,
    Error,
    RespondToCalendarJoinRequestArgs,
    unknown
  >
) {
  return useMutation(() => ({
    mutationFn: respondToCalendarJoinRequest,
    ...withCallbacks<
      CalendarJoinRequest,
      Error,
      RespondToCalendarJoinRequestArgs
    >(
      {
        // Settles once the list refetched, so the answered row is gone
        // before the buttons enable again.
        onSettled: async (_data, _error, { request, decision }) => {
          const listRefreshed = queryClient.invalidateQueries({
            queryKey: calendarKeys.joinRequests(request.eventId).queryKey,
          });
          if (decision === 'accept') {
            invalidateCalendarEventPreviews(request.eventId);
            await invalidateCalendarOccurrences();
          }
          await listRefreshed;
        },
      },
      callbacks
    ),
  }));
}
