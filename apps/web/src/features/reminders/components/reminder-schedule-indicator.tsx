import ClockIcon from '@phosphor/clock.svg';
import { Button, Tooltip } from '@ui';
import { createSignal } from 'solid-js';

/** Persistent metadata, independent of a row's hover actions and timestamp. */
export function ReminderScheduleIndicator(props: {
  label: string;
  onEdit: () => void;
}) {
  const [focused, setFocused] = createSignal(false);
  return (
    <span
      class="inline-flex shrink-0"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
      onFocusIn={() => setFocused(true)}
      onFocusOut={() => setFocused(false)}
    >
      <Tooltip label={props.label} open={focused() ? true : undefined}>
        <Button size="icon-sm" aria-label={props.label} onClick={props.onEdit}>
          <ClockIcon class="size-4" />
        </Button>
      </Tooltip>
    </span>
  );
}
