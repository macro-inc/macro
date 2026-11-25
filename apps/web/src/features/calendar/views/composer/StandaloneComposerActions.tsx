import { EventForwardInvitationAction } from '@app/features/calendar-view/components/EventGuests';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CalendarUpdateScope } from '@service-email/client';
import { Button, Dropdown } from '@ui';
import { type Accessor, Show } from 'solid-js';
import { ComposerScopeOptions } from '../../components/composer/actions/ComposerSubmit';
import type { EventReplacementRequest } from '../../core/event-replacement';
import { createGuestInviteController } from '../../hooks/create-guest-invite-controller';
import type { CalendarEvent } from '../../types';
import { viewerReplacesGuests } from '../../utils/event-guest-editing';
import { EventReplacement, useEventReplacement } from '../event-replacement';

/** Permission-gated forwarding lives beside the footer's save/cancel actions. */
export function StandaloneComposerForward(props: {
  event: CalendarEvent;
  guestInvitesEnabled: Accessor<boolean>;
  forwardEnabled: Accessor<boolean>;
  disabled: boolean;
}) {
  const invites = createGuestInviteController(
    () => props.event,
    props.guestInvitesEnabled,
    props.forwardEnabled
  );
  return (
    <Show when={invites.canForward()}>
      <EventForwardInvitationAction
        event={props.event}
        invites={invites}
        showLabel
        disabled={props.disabled}
      />
    </Show>
  );
}

/** Replace provider meetings with the current draft. */
export function StandaloneComposerActions(props: {
  event: CalendarEvent;
  disabled: boolean;
  recurring?: boolean;
  replacementRequest: (
    scope?: CalendarUpdateScope
  ) => EventReplacementRequest | undefined;
  onDone: () => void;
}) {
  const replacement = useEventReplacement(() => props.event.eventId);
  const canReplace = () =>
    props.event.calendar.provider === 'outlook' &&
    !!props.event.conferenceUrl &&
    !props.event.isCancelled &&
    viewerReplacesGuests(props.event);
  const startReplacement = (scope?: CalendarUpdateScope) => {
    const request = props.replacementRequest(scope);
    if (request)
      fireAndForget(replacement.start(request), 'calendar-replacement');
  };
  return (
    <>
      <Show when={canReplace()}>
        <Show
          when={props.recurring}
          fallback={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              onClick={() => startReplacement()}
            >
              {t('calendar.replaceWithoutMeeting')}
            </Button>
          }
        >
          <Dropdown placement="top-start">
            <Dropdown.Trigger
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.disabled}
            >
              {t('calendar.replaceWithoutMeeting')}
            </Dropdown.Trigger>
            <Dropdown.Content portalScope="local">
              <ComposerScopeOptions onSelect={startReplacement} />
            </Dropdown.Content>
          </Dropdown>
        </Show>
      </Show>
      <EventReplacement controller={replacement} onDone={props.onDone} />
    </>
  );
}
