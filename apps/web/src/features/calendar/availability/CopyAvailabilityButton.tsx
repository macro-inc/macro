import CalendarCheckIcon from '@phosphor/calendar-check.svg';
import { Button, type ButtonSize, openDialog } from '@ui';
import { getOwner, Show } from 'solid-js';
import { useCalendarConnectedInboxes } from '../hooks/use-calendar-connected-inboxes';
import { CopyAvailabilityDialog } from './CopyAvailabilityDialog';

/** Opens the shared availability dialog when a calendar account is connected. */
export function CopyAvailabilityButton(props: {
  class?: string;
  size?: ButtonSize;
}) {
  const owner = getOwner();
  const connectedInboxes = useCalendarConnectedInboxes();

  return (
    <Show when={connectedInboxes().length > 0}>
      <Button
        variant="ghost"
        size={props.size ?? 'icon-sm'}
        class={props.class}
        label="Copy availability"
        onClick={() => openDialog(CopyAvailabilityDialog, {}, { owner })}
      >
        <CalendarCheckIcon />
      </Button>
    </Show>
  );
}
