import { t } from '@app/lib/i18n';
import CalendarPlusIcon from '@icon/system/regular/calendar-plus.svg';
import { Button, cn } from '@ui';

/**
 * Opens an event from the draft. It is accented while the draft reads like it
 * proposes a meeting, so the action is offered when it is likely wanted.
 */
export function CreateEventButton(props: {
  suggested: boolean;
  onClick: () => void;
  /** The thread's own key for the same action, shown in the tooltip. */
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-md"
      aria-label={t('entityActions.createEvent')}
      tooltip={{
        content: t('entityActions.createEvent'),
        shortcut: props.shortcut,
      }}
      data-suggested={props.suggested ? '' : undefined}
      class={cn(
        props.suggested &&
          'bg-accent/15 text-accent hover:bg-accent/20! hover:text-accent!'
      )}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <CalendarPlusIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}
