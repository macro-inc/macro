import { EventForwardInvitationAction } from '@app/features/calendar-view/components/EventGuests';
import { type Accessor, Show } from 'solid-js';
import { createGuestInviteController } from '../../hooks/create-guest-invite-controller';
import type { CalendarEvent } from '../../types';
import { viewerReplacesGuests } from '../../utils/event-guest-editing';
import { EventReplacementAction } from '../event-replacement';

/** Keep the existing forwarding and provider-replacement workflows available. */
export function StandaloneComposerActions(props: {
  event: CalendarEvent;
  guestInvitesEnabled: Accessor<boolean>;
  forwardEnabled: Accessor<boolean>;
  disabled: boolean;
  onDone: () => void;
}) {
  const invites = createGuestInviteController(
    () => props.event,
    props.guestInvitesEnabled,
    props.forwardEnabled
  );
  const canReplace = () =>
    props.event.calendar.provider === 'outlook' &&
    !props.event.isCancelled &&
    viewerReplacesGuests(props.event);
  return (
    <>
      <Show when={invites.canForward()}>
        <EventForwardInvitationAction event={props.event} invites={invites} />
      </Show>
      <Show when={canReplace()}>
        <EventReplacementAction
          target={{
            eventId: props.event.eventId,
            calendarId: props.event.calendarId,
            recurrenceId: props.event.recurrenceId,
          }}
          hasConference={
            props.event.conferenceUrl !== undefined &&
            props.event.conferenceProvider !== undefined
          }
          recurring={
            props.event.recurrenceLines.length > 0 ||
            props.event.recurrenceId !== undefined
          }
          disabled={props.disabled}
          onDone={props.onDone}
        />
      </Show>
    </>
  );
}
