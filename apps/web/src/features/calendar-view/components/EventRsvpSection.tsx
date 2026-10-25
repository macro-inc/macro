import type { CalendarEvent } from '@app/features/calendar/types';
import { OutlookRsvpAction } from '@app/features/calendar/views/event-replacement';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { EventRsvpScopeDialog } from '../../calendar/components/EventRsvpScopeDialog';
import { createCalendarRsvpController } from '../../calendar/hooks/create-calendar-rsvp-controller';

type RsvpResponse = Exclude<AttendeeResponseStatus, 'needs_action'>;

const RSVP_OPTIONS = [
  { response: 'accepted', label: 'Yes' },
  { response: 'tentative', label: 'Maybe' },
  { response: 'declined', label: 'No' },
] as const satisfies readonly {
  response: RsvpResponse;
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
  // A snapshot lists the viewer only so Google would take the copy; an answer
  // there would never reach the organizer.
  const canRespond = () =>
    selfAttendee() !== undefined &&
    !props.event.isReadOnly &&
    !props.event.isCancelled &&
    !props.event.isSnapshot;

  const rsvp = createCalendarRsvpController(() =>
    canRespond()
      ? {
          eventId: props.event.eventId,
          respondingEmail: selfAttendee()?.email,
          occurrenceKey: props.event.occurrenceKey,
          recurrenceId: props.event.recurrenceId,
          recurring: isRecurring(),
        }
      : undefined
  );

  return (
    <Show when={canRespond()}>
      <div class="border-edge-muted flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-active px-4 py-2.5 text-sm text-ink-muted sm:text-xs mobile:border-0 mobile:bg-transparent mobile:px-6 mobile:pt-4 mobile:pb-2">
        <span class="flex shrink-0 items-center gap-2">
          Going?
          <span role="status" class="size-3.5">
            <Show when={rsvp.pending()}>
              <SpinnerIcon
                aria-hidden="true"
                class="size-3.5 animate-spin motion-reduce:animate-none"
              />
              <span class="sr-only">Saving response…</span>
            </Show>
          </span>
        </span>
        <div class="ml-auto flex shrink-0 gap-3 lg:gap-2">
          <For each={RSVP_OPTIONS}>
            {(option) => (
              <Button
                variant="ghost"
                size={props.buttonSize ?? 'sm'}
                depth={3}
                class="bg-ink/5 px-3 aria-pressed:bg-accent-bg aria-pressed:text-accent mobile:min-h-11"
                aria-pressed={
                  selfAttendee()?.responseStatus === option.response
                }
                onClick={() => rsvp.respond(option.response)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </div>
        <Show when={rsvp.error()}>
          {(error) => (
            <p role="alert" class="basis-full text-xs text-failure">
              {error()}
            </p>
          )}
        </Show>
      </div>
      <Show
        when={
          props.event.calendar.provider === 'outlook' &&
          !selfAttendee()?.isOrganizer
        }
      >
        <OutlookRsvpAction
          target={{
            eventId: props.event.eventId,
            calendarId: props.event.calendarId,
            recurrenceId: props.event.recurrenceId,
          }}
        />
      </Show>
      <EventRsvpScopeDialog
        open={rsvp.scopeOpen()}
        scope={rsvp.scope()}
        onScopeChange={rsvp.setScope}
        onClose={rsvp.closeScope}
        onConfirm={rsvp.confirmScope}
      />
    </Show>
  );
}
