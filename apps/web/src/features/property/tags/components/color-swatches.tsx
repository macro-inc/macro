import { cn, Tooltip } from '@ui';
import { For } from 'solid-js';
import { TagDot } from '../TagDot';
import {
  optionColorOf,
  TAG_COLOR_OPTIONS,
  type TagColorOption,
} from '../tagColors';

/** The palette as a row of swatches; the one matching `value` (a stored hex) is marked. */
export function ColorSwatches(props: {
  value: string | null | undefined;
  onChange: (color: TagColorOption) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const selected = () => optionColorOf(props.value)?.color;
  return (
    <div
      role="radiogroup"
      aria-label="Color"
      class="flex flex-wrap items-center"
      classList={{
        'gap-2': props.size !== 'sm',
        'gap-1': props.size === 'sm',
      }}
    >
      <For each={TAG_COLOR_OPTIONS}>
        {(option) => (
          <Tooltip label={option.name}>
            <button
              type="button"
              role="radio"
              aria-label={option.name}
              aria-checked={selected() === option.color}
              disabled={props.disabled}
              onClick={() => props.onChange(option)}
              class={cn(
                'flex items-center justify-center rounded-md border outline-none hover:bg-hover focus-visible:border-accent disabled:opacity-50',
                props.size === 'sm' ? 'size-6' : 'size-7',
                selected() === option.color
                  ? 'border-accent bg-accent-bg'
                  : 'border-edge-muted'
              )}
            >
              <TagDot
                color={option.color}
                class={props.size === 'sm' ? 'size-3' : 'size-3.5'}
              />
            </button>
          </Tooltip>
        )}
      </For>
    </div>
  );
}
