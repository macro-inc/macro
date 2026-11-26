import CheckIcon from '@icon/system/regular/check.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export function PhoneMenuChoice(props: {
  label: string;
  detail?: string;
  icon?: JSX.Element;
  status?: JSX.Element;
  selected?: boolean;
  disabled?: boolean;
  onChoose: () => void;
}) {
  return (
    <Button
      variant="row"
      size="sheet-row"
      fullWidth
      class="justify-start gap-3 px-3 text-left font-normal"
      aria-pressed={props.selected}
      disabled={props.disabled}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onChoose}
    >
      {props.icon}
      <span class="min-w-0 flex-1">
        <span class="block">{props.label}</span>
        <Show when={props.detail}>
          <span class="block text-xs text-ink-subtle">{props.detail}</span>
        </Show>
      </span>
      {props.status}
      <Show when={props.selected}>
        <CheckIcon class="size-4 shrink-0" />
      </Show>
    </Button>
  );
}
