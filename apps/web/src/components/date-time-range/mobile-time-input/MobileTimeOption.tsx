import CheckIcon from '@icon/system/regular/check.svg';
import { Button } from '@ui';
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
    <Button
      id={props.id}
      variant="ghost"
      appearance="bare"
      size="sheet"
      role="option"
      tabindex="-1"
      aria-selected={props.selected}
      data-highlighted={props.highlighted ? '' : undefined}
      data-selected={props.selected ? '' : undefined}
      class="w-full justify-between rounded-2xl text-left font-normal text-ink data-selected:bg-accent/18 data-selected:text-accent data-highlighted:not-data-selected:bg-ink/5"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onChoose(props.option)}
    >
      <span>{props.option.label}</span>
      <span class="flex shrink-0 items-center gap-2">
        <Show when={props.option.detail}>
          {(detail) => (
            <span class="text-[13px] text-ink-extra-muted">{detail()}</span>
          )}
        </Show>
        <Show when={props.selected}>
          <CheckIcon class="size-4 text-accent" />
        </Show>
      </span>
    </Button>
  );
}
