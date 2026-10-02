import { isTouchDevice } from '@core/mobile/isTouchDevice';
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
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.pointerType === 'touch') setFocused(false);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
      onFocusIn={(event) =>
        setFocused(
          !isTouchDevice() ||
            (event.target instanceof HTMLElement &&
              event.target.matches(':focus-visible'))
        )
      }
      onFocusOut={() => setFocused(false)}
    >
      <Tooltip
        label={props.label}
        open={focused() ? true : isTouchDevice() ? false : undefined}
      >
        <Button size="icon-sm" aria-label={props.label} onClick={props.onEdit}>
          <ClockIcon class="size-4" />
        </Button>
      </Tooltip>
    </span>
  );
}
