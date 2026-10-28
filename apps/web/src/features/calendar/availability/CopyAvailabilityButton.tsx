import { CALENDAR_TOUR } from '@app/features/calendar-view/tour';
import CalendarCheckIcon from '@icon/system/regular/calendar-check.svg';
import { Button, type ButtonSize, useImperativeDialog } from '@ui';
import { tourTarget } from '@ui/components/Tour';
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
        aria-label="Copy availability"
        tooltip="Copy availability"
        ref={tourTarget(CALENDAR_TOUR.availability)}
        variant="ghost"
        size={props.size ?? 'icon-sm'}
        class={props.class}
        onClick={showDialog}
      >
        <CalendarCheckIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
      </Button>
    </Show>
  );
}
