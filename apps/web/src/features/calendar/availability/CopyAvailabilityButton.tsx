import CalendarCheckIcon from '@phosphor/calendar-check.svg';
import { Button, type ButtonSize, useImperativeDialog } from '@ui';
import { Show } from 'solid-js';
import { useCalendarConnectedInboxes } from '../hooks/use-calendar-connected-inboxes';
import { CopyAvailabilityDialog } from './CopyAvailabilityDialog';

/** Opens the shared availability dialog when a calendar account is connected. */
export function CopyAvailabilityButton(props: {
  class?: string;
  size?: ButtonSize;
}) {
  const dialog = useImperativeDialog(CopyAvailabilityDialog);
  const connectedInboxes = useCalendarConnectedInboxes();
  const showDialog = () => {
    if (!dialog.isOpen()) dialog.open({});
  };

  return (
    <Show when={connectedInboxes().length > 0}>
      <Button
        variant="ghost"
        size={props.size ?? 'icon-sm'}
        class={props.class}
        label="Copy availability"
        onClick={showDialog}
      >
        <CalendarCheckIcon />
      </Button>
    </Show>
  );
}
