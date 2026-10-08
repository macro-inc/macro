import { toast } from '@core/component/Toast/Toast';
import { useDisableCalendarMutation } from '@queries/email/link';
import { Button, Dialog, Panel } from '@ui';
import { Show } from 'solid-js';

/** The inbox a turn-off confirmation is about. */
export interface TurnOffCalendarTarget {
  linkId: string;
  emailAddress: string;
}

/**
 * Confirms turning calendar off for one inbox and runs the disable. Shared by
 * the connected-accounts settings row and the calendar view's settings menu so
 * both entry points remove the same thing and describe it the same way.
 *
 * Rendered with a `null` target while closed; callers hold the target signal.
 */
export function TurnOffCalendarDialog(props: {
  target: TurnOffCalendarTarget | null;
  onClose: () => void;
}) {
  const disableCalendar = useDisableCalendarMutation({
    onSuccess: () => {
      toast.success('Calendar turned off');
      props.onClose();
    },
    onError: () =>
      toast.failure('Failed to turn off calendar. Please try again.'),
  });

  const confirm = () => {
    const target = props.target;
    if (!target || disableCalendar.isPending) return;
    disableCalendar.mutate(target.linkId);
  };

  return (
    <Dialog
      open={props.target !== null}
      onOpenChange={(open) => {
        if (!open && !disableCalendar.isPending) props.onClose();
      }}
      position="center"
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <Dialog.Title class="text-ink text-sm font-semibold">
            Turn off calendar
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-6 font-sans flex flex-col gap-3">
          <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
            Turn off calendar for{' '}
            <span class="text-ink">{props.target?.emailAddress}</span>? Macro
            deletes its copy of these events and gives up calendar access. Your
            Google Calendar is untouched and email keeps syncing, but turning
            calendar back on means granting access again.
          </Dialog.Description>
          <Show when={disableCalendar.isPending}>
            <p role="status" class="text-sm text-ink-muted">
              Turning off calendar and removing synced events…
            </p>
          </Show>
          <div class="pt-3 justify-end items-center gap-3 inline-flex">
            <Button
              variant="ghost"
              depth={3}
              onClick={props.onClose}
              disabled={disableCalendar.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="strong"
              depth={3}
              onClick={confirm}
              disabled={disableCalendar.isPending}
            >
              {disableCalendar.isPending ? 'Turning off…' : 'Turn off'}
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
