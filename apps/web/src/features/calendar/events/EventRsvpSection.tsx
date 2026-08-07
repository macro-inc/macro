import { toast } from '@core/component/Toast/Toast';
import { useRsvpCalendarEventMutation } from '@queries/calendar/mutations';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import type { CalendarEvent } from './types';

const RSVP_OPTIONS = [
  { response: 'accepted', label: 'Yes' },
  { response: 'tentative', label: 'Maybe' },
  { response: 'declined', label: 'No' },
] as const satisfies readonly {
  response: Exclude<AttendeeResponseStatus, 'needs_action'>;
  label: string;
}[];

/**
 * RSVP controls for the connected account's own attendance. Recurring
 * events respond for the entire series, matching the backend semantics.
 */
export function EventRsvpSection(props: { event: CalendarEvent }) {
  const selfAttendee = createMemo(() =>
    props.event.attendees.find((attendee) => attendee.isSelf)
  );
  const canRespond = () =>
    selfAttendee() !== undefined &&
    !props.event.isReadOnly &&
    !props.event.isCancelled;

  const rsvp = useRsvpCalendarEventMutation({
    onError: (error) => {
      toast.failure('Failed to update RSVP', { subtext: error.message });
    },
  });

  return (
    <Show when={canRespond()}>
      <div class="border-edge-muted flex items-center gap-3 border-t px-4 py-2.5 text-xs text-ink-muted">
        <span>Going?</span>
        <div class="ml-auto flex shrink-0 gap-1">
          <For each={RSVP_OPTIONS}>
            {(option) => (
              <Button
                variant={
                  selfAttendee()?.responseStatus === option.response
                    ? 'active'
                    : 'ghost'
                }
                size="sm"
                class="rounded-lg px-2.5"
                disabled={rsvp.isPending}
                label={option.label}
                onClick={() =>
                  rsvp.mutate({
                    eventId: props.event.eventId,
                    response: option.response,
                  })
                }
              >
                {option.label}
              </Button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
