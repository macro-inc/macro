import { throwOnErr } from '@core/util/result';
import { invalidateCalendarInvitations } from '@queries/calendar/invitations';
import { calendarKeys } from '@queries/calendar/keys';
import { invalidateCalendarEventPreviews } from '@queries/calendar/mention-preview';
import { invalidateCalendarOccurrences } from '@queries/calendar/occurrences';
import type { CalendarReplacementView } from '@service-calendar/generated/schemas';
import { emailClient } from '@service-email/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { EventReplacementSource } from '../context/event-replacement-source';
import type {
  EventReplacementPreview,
  EventReplacementTarget,
} from '../core/event-replacement';

export function decodeReplacement(
  view: CalendarReplacementView
): EventReplacementPreview {
  const time = view.time;
  return {
    ...view,
    startsAt: time.kind === 'timed' ? time.startsAt : time.startDate,
    endsAt: time.kind === 'timed' ? time.endsAt : time.endDate,
    allDay: time.kind === 'allDay',
    providerUrl: view.providerUrl ?? undefined,
    replacementUrl: view.replacementUrl ?? undefined,
  };
}

export function useEventReplacementSource(
  eventId: Accessor<string>
): EventReplacementSource {
  const prepare = useMutation(() => ({
    mutationFn: async (args: {
      target: EventReplacementTarget;
      removeConference: boolean;
    }) =>
      decodeReplacement(
        await throwOnErr(() =>
          emailClient.prepareCalendarReplacement(args.target.eventId, {
            calendarId: args.target.calendarId,
            recurrenceId: args.target.recurrenceId,
            removeConference: args.removeConference,
          })
        )
      ),
  }));
  const confirm = useMutation(() => ({
    mutationFn: async (id: string) =>
      decodeReplacement(
        await throwOnErr(() => emailClient.confirmCalendarReplacement(id))
      ),
    onSettled: () => {
      invalidateCalendarEventPreviews(eventId());
      void invalidateCalendarInvitations();
      void invalidateCalendarOccurrences();
    },
  }));
  const discard = useMutation(() => ({
    mutationFn: async (id: string) => {
      await throwOnErr(() => emailClient.discardCalendarReplacement(id));
    },
  }));
  const status = useMutation(() => ({
    mutationFn: async (id: string) =>
      decodeReplacement(
        await throwOnErr(() => emailClient.calendarReplacementStatus(id))
      ),
    onSuccess: (view) => {
      if (view.status === 'complete') {
        invalidateCalendarEventPreviews(eventId());
        void invalidateCalendarInvitations();
        void invalidateCalendarOccurrences();
      }
    },
  }));
  return {
    prepare: (target, removeConference) =>
      prepare.mutateAsync({ target, removeConference }),
    confirm: (id) => confirm.mutateAsync(id),
    status: (id) => status.mutateAsync(id),
    discard: (id) => discard.mutateAsync(id),
  };
}

/** Mounted inside the small provider-action Suspense boundary, never the calendar viewport. */
export function useCalendarProviderUrl(
  target: Accessor<EventReplacementTarget>
) {
  return useQuery(() => ({
    queryKey: [
      ...calendarKeys._def,
      'provider-url',
      target().eventId,
      target().calendarId,
      target().recurrenceId,
    ],
    queryFn: async () =>
      (
        await throwOnErr(() =>
          emailClient.calendarEventProviderUrl(target().eventId, target())
        )
      ).url,
    staleTime: 60_000,
  }));
}
