import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { CalendarJoinRequest } from '@service-calendar/generated/schemas/calendarJoinRequest';
import type { CalendarJoinRequestDecision } from '@service-calendar/generated/schemas/calendarJoinRequestDecision';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys } from './keys';
import { invalidateCalendarEventPreviews } from './mention-preview';
import { invalidateCalendarOccurrences } from './occurrences';

/**
 * Pending requests to join one of the viewer's events, oldest first. Only an
 * owner or delegate of the event may list them.
 */
export function useCalendarJoinRequestsQuery(
  eventId: Accessor<string | undefined>,
  options?: Accessor<{ enabled?: boolean }>
) {
  return useQuery(() => {
    const id = eventId();
    return {
      queryKey: calendarKeys.joinRequests(id ?? '').queryKey,
      queryFn: async () => {
        if (!id) throw new Error('Calendar event is unavailable');
        return (
          await throwOnErr(() =>
            storageServiceClient.listCalendarEventJoinRequests(id)
          )
        ).requests;
      },
      enabled: id !== undefined && options?.().enabled !== false,
      staleTime: 30_000,
    };
  });
}

/**
 * Asks the owner of an event shared with one of the viewer's channels to add
 * them as a guest. The mention preview carries the request's status, so it
 * is refetched to show the request as sent.
 */
export function useRequestToJoinCalendarEventMutation(
  callbacks?: MutationCallbacks<CalendarJoinRequest, Error, string, unknown>
) {
  return useMutation(() => ({
    mutationFn: async (eventId: string) =>
      await throwOnErr(() =>
        storageServiceClient.requestToJoinCalendarEvent(eventId)
      ),
    ...withCallbacks<CalendarJoinRequest, Error, string>(
      {
        onSettled: (_data, _error, eventId) =>
          invalidateCalendarEventPreviews(eventId),
      },
      callbacks
    ),
  }));
}

type RespondArgs = {
  request: CalendarJoinRequest;
  decision: CalendarJoinRequestDecision;
};

/**
 * Answers a join request on one of the viewer's events. Accepting adds the
 * requester as a guest, so the event's occurrences are refetched too.
 */
export function useRespondToCalendarJoinRequestMutation(
  callbacks?: MutationCallbacks<
    CalendarJoinRequest,
    Error,
    RespondArgs,
    unknown
  >
) {
  return useMutation(() => ({
    mutationFn: async ({ request, decision }: RespondArgs) =>
      await throwOnErr(() =>
        emailClient.respondToCalendarJoinRequest(request.id, { decision })
      ),
    ...withCallbacks<CalendarJoinRequest, Error, RespondArgs>(
      {
        onSettled: (_data, _error, { request, decision }) => {
          void queryClient.invalidateQueries({
            queryKey: calendarKeys.joinRequests(request.eventId).queryKey,
          });
          if (decision === 'accept') {
            invalidateCalendarEventPreviews(request.eventId);
            return invalidateCalendarOccurrences();
          }
        },
      },
      callbacks
    ),
  }));
}
