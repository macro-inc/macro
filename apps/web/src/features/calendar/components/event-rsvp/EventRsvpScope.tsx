import { Show } from 'solid-js';
import { useEventRsvp } from '../../context/event-rsvp-context';
import { OutlookRsvpAction } from '../../views/event-replacement';
import { EventRsvpScopeDialog } from '../EventRsvpScopeDialog';

/** Every response placement keeps recurring scope and Outlook replacement behavior. */
export function EventRsvpScope() {
  const response = useEventRsvp();
  const showOutlook = () =>
    response.canRespond() && response.event().calendar.provider === 'outlook';
  return (
    <>
      <Show when={showOutlook()}>
        <OutlookRsvpAction
          target={{
            eventId: response.event().eventId,
            calendarId: response.event().calendarId,
            recurrenceId: response.event().recurrenceId,
          }}
        />
      </Show>
      <Show when={response.canRespond()}>
        <EventRsvpScopeDialog
          open={response.rsvp.scopeOpen()}
          scope={response.rsvp.scope()}
          onScopeChange={response.rsvp.setScope}
          onClose={response.rsvp.closeScope}
          onConfirm={response.rsvp.confirmScope}
        />
      </Show>
    </>
  );
}
