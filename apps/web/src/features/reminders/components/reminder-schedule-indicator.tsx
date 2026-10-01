import ClockIcon from '@phosphor/clock.svg';
import { Button } from '@ui';

/** Persistent metadata, independent of a row's hover actions and timestamp. */
export function ReminderScheduleIndicator(props: {
  label: string;
  onEdit: () => void;
}) {
  return (
    <span
      class="inline-flex shrink-0"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <Button size="icon-sm" label={props.label} onClick={props.onEdit}>
        <ClockIcon class="size-4" />
      </Button>
    </span>
  );
}
