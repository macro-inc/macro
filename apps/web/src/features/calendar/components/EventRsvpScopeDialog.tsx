import type { CalendarRsvpScope } from '@service-email/client';
import { RecurringEventScopeDialog } from './RecurringEventScopeDialog';

const SCOPE_OPTIONS = [
  { scope: 'this_event', label: 'This event' },
  { scope: 'all', label: 'All events' },
] as const satisfies readonly {
  scope: CalendarRsvpScope;
  label: string;
}[];

/** The caller owns the pending response; dismissing never submits it. */
export function EventRsvpScopeDialog(props: {
  open: boolean;
  scope: CalendarRsvpScope;
  onScopeChange: (scope: CalendarRsvpScope) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <RecurringEventScopeDialog
      open={props.open}
      title="RSVP to recurring event"
      options={SCOPE_OPTIONS}
      scope={props.scope}
      onScopeChange={props.onScopeChange}
      onClose={props.onClose}
      onConfirm={props.onConfirm}
      confirmLabel="OK"
      mobileConfirmLabel="Save response"
      description="Apply your response to:"
      scopeLabel="Response applies to"
      closeLabel="Close RSVP"
    />
  );
}
