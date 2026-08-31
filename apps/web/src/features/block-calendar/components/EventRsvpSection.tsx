import type { CalendarEvent } from '@app/features/calendar/types';
import { toast } from '@core/component/Toast/Toast';
import CloseIcon from '@phosphor/x.svg';
import { useRsvpCalendarEventMutation } from '@queries/calendar/mutations';
import type { CalendarRsvpScope } from '@service-email/client';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import { Button, Dialog, Panel } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

type RsvpResponse = Exclude<AttendeeResponseStatus, 'needs_action'>;

const RSVP_OPTIONS = [
  { response: 'accepted', label: 'Yes' },
  { response: 'tentative', label: 'Maybe' },
  { response: 'declined', label: 'No' },
] as const satisfies readonly {
  response: RsvpResponse;
  label: string;
}[];

const SCOPE_OPTIONS = [
  { scope: 'this_event', label: 'This event' },
  { scope: 'all', label: 'All events' },
] as const satisfies readonly {
  scope: CalendarRsvpScope;
  label: string;
}[];

/**
 * RSVP controls for the connected account's own attendance.
 *
 * A recurring event asks whether the answer covers this occurrence or the
 * whole series. Google records an occurrence answer as an exception
 * instance, so responses can differ per occurrence. There is deliberately no
 * "this and following" option: the provider API cannot express a forward
 * response, so it would silently expire past the synced window.
 */
export function EventRsvpSection(props: {
  event: CalendarEvent;
  buttonSize?: 'sm' | 'md';
}) {
  const selfAttendee = createMemo(() =>
    props.event.attendees.find((attendee) => attendee.isSelf)
  );
  const isRecurring = () =>
    props.event.recurrenceLines.length > 0 ||
    props.event.recurrenceId !== undefined;
  const canRespond = () =>
    selfAttendee() !== undefined &&
    !props.event.isReadOnly &&
    !props.event.isCancelled;

  const [pendingResponse, setPendingResponse] = createSignal<RsvpResponse>();
  const [scope, setScope] = createSignal<CalendarRsvpScope>('this_event');

  const rsvp = useRsvpCalendarEventMutation({
    onError: (error) => {
      toast.failure('Failed to update RSVP', { subtext: error.message });
    },
  });

  const submit = (
    response: RsvpResponse,
    effectiveScope: CalendarRsvpScope
  ) => {
    rsvp.mutate({
      eventId: props.event.eventId,
      response,
      scope: effectiveScope,
      recurrenceId:
        effectiveScope === 'all'
          ? undefined
          : (props.event.recurrenceId ?? props.event.occurrenceKey),
      occurrenceKey:
        effectiveScope === 'all' ? undefined : props.event.occurrenceKey,
    });
  };

  const respond = (response: RsvpResponse) => {
    // A single occurrence is its own series, so there is nothing to scope.
    if (!isRecurring()) {
      submit(response, 'all');
      return;
    }
    setScope('this_event');
    setPendingResponse(response);
  };

  const confirm = () => {
    const response = pendingResponse();
    if (response === undefined) return;
    submit(response, scope());
    setPendingResponse(undefined);
  };

  return (
    <Show when={canRespond()}>
      <div class="border-edge-muted flex items-center gap-3 border-t bg-active px-4 py-2.5 text-sm text-ink-muted sm:text-xs">
        <span>Going?</span>
        <div class="ml-auto flex shrink-0 gap-3 lg:gap-2">
          <For each={RSVP_OPTIONS}>
            {(option) => (
              <Button
                variant={
                  selfAttendee()?.responseStatus === option.response
                    ? 'accent'
                    : 'outline'
                }
                size={props.buttonSize ?? 'sm'}
                depth={3}
                class="rounded-lg px-3"
                onClick={() => respond(option.response)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </div>
      </div>
      <Dialog
        open={pendingResponse() !== undefined}
        onOpenChange={(open) => !open && setPendingResponse(undefined)}
      >
        <Panel depth={2} class="max-w-[calc(100vw-2rem)] rounded-xl text-ink">
          <Panel.Header class="gap-1 px-2">
            <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
              <CloseIcon />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
              RSVP to recurring event
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="flex flex-col gap-3 p-3">
            <div class="flex max-w-80 flex-col gap-2 text-sm text-ink-muted">
              <For each={SCOPE_OPTIONS}>
                {(option) => (
                  <label class="flex items-center gap-2">
                    <input
                      type="radio"
                      name="rsvp-scope"
                      checked={scope() === option.scope}
                      onChange={() => setScope(option.scope)}
                    />
                    {option.label}
                  </label>
                )}
              </For>
            </div>
            <div class="flex justify-end gap-1 pt-2">
              <Button
                variant="ghost"
                class="rounded-lg"
                onClick={() => setPendingResponse(undefined)}
              >
                Cancel
              </Button>
              <Button variant="accent" class="rounded-lg" onClick={confirm}>
                OK
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </Show>
  );
}
