import { useRsvpCalendarEventMutation } from '@queries/calendar/mutations';
import type { CalendarRsvpScope } from '@service-email/client';
import { type Accessor, createSignal } from 'solid-js';

export type CalendarRsvpTarget = {
  eventId: string;
  respondingEmail?: string;
  occurrenceKey: string;
  recurrenceId?: string;
  recurring: boolean;
};
export type CalendarRsvpResponse = 'accepted' | 'tentative' | 'declined';

/** Shared response/scope interaction; optimistic ownership lives in the mutation. */
export function createCalendarRsvpController(
  target: Accessor<CalendarRsvpTarget | undefined>
) {
  const [pendingResponse, setPendingResponse] =
    createSignal<CalendarRsvpResponse>();
  const [scope, setScope] = createSignal<CalendarRsvpScope>('this_event');
  const [error, setError] = createSignal<string>();
  const mutation = useRsvpCalendarEventMutation();
  let submission = 0;
  const submit = (response: CalendarRsvpResponse, scope: CalendarRsvpScope) => {
    const event = target();
    if (!event) return;
    if (!navigator.onLine) {
      setError('You are offline. Reconnect to send your response.');
      return;
    }
    setError(undefined);
    const revision = ++submission;
    mutation.mutate(
      {
        eventId: event.eventId,
        respondingEmail: event.respondingEmail,
        response,
        scope,
        recurrenceId:
          scope === 'all'
            ? undefined
            : (event.recurrenceId ?? event.occurrenceKey),
        occurrenceKey: scope === 'all' ? undefined : event.occurrenceKey,
      },
      {
        onError: () => {
          if (revision === submission)
            setError('Could not save your response. Please try again.');
        },
      }
    );
  };
  return {
    pending: () => mutation.isPending,
    error,
    scope,
    setScope,
    scopeOpen: () => pendingResponse() !== undefined,
    closeScope: () => setPendingResponse(undefined),
    respond: (response: CalendarRsvpResponse) => {
      const event = target();
      if (!event) return;
      if (!event.recurring) {
        submit(response, 'all');
        return;
      }
      setScope('this_event');
      setPendingResponse(response);
    },
    confirmScope: () => {
      const response = pendingResponse();
      if (!response) return;
      submit(response, scope());
      setPendingResponse(undefined);
    },
  };
}
