import { EventForwardInvitationAction } from '@app/features/calendar-view/components/EventGuests';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import { type Accessor, Show } from 'solid-js';
import type { EventReplacementRequest } from '../../core/event-replacement';
import { createGuestInviteController } from '../../hooks/create-guest-invite-controller';
import type { CalendarEvent } from '../../types';
import { viewerReplacesGuests } from '../../utils/event-guest-editing';
import { EventReplacement, useEventReplacement } from '../event-replacement';

/** Forward invitations and replace provider meetings with the current draft. */
export function StandaloneComposerActions(props: {
  event: CalendarEvent;
  guestInvitesEnabled: Accessor<boolean>;
  forwardEnabled: Accessor<boolean>;
  disabled: boolean;
  replacementRequest: () => EventReplacementRequest | undefined;
  onDone: () => void;
}) {
  const invites = createGuestInviteController(
    () => props.event,
    props.guestInvitesEnabled,
    props.forwardEnabled
  );
  const replacement = useEventReplacement(() => props.event.eventId);
  const canReplace = () =>
    props.event.calendar.provider === 'outlook' &&
    !!props.event.conferenceUrl &&
    !props.event.isCancelled &&
    viewerReplacesGuests(props.event);
  const startReplacement = () => {
    const request = props.replacementRequest();
    if (request)
      fireAndForget(replacement.start(request), 'calendar-replacement');
  };
  return (
    <>
      <Show when={invites.canForward()}>
        <EventForwardInvitationAction event={props.event} invites={invites} />
      </Show>
      <Show when={canReplace()}>
        <Button
          variant="ghost"
          size="sm"
          disabled={props.disabled}
          onClick={startReplacement}
        >
          {t('calendar.replaceWithoutMeeting')}
        </Button>
      </Show>
      <EventReplacement controller={replacement} onDone={props.onDone} />
    </>
  );
}
