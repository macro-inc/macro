import CheckIcon from '@icon/system/regular/check.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';
import type { TimeOption } from '../time-options';

export function MobileTimeOption(props: {
  id: string;
  option: TimeOption;
  selected: boolean;
  highlighted: boolean;
  onChoose: (option: TimeOption) => void;
}) {
  return (
    <Dropdown.ItemFrame
      id={props.id}
      role="option"
      tabindex="-1"
      aria-selected={props.selected}
      data-highlighted={props.highlighted ? '' : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onChoose(props.option)}
    >
      <span>{props.option.label}</span>
      <span class="flex shrink-0 items-center gap-2">
        <Show when={props.option.detail}>
          {(detail) => (
            <span class="text-xs text-ink-extra-muted">{detail()}</span>
          )}
        </Show>
        <Show when={props.selected}>
          <CheckIcon class="size-4 text-accent" />
        </Show>
      </span>
    </Dropdown.ItemFrame>
  );
}
