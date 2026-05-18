import CheckIcon from '@icon/check.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';

export interface MultiSelectCheckboxProps {
  checked?: boolean;
  onChecked?: (checked: boolean, shiftKey: boolean) => void;
}

/**
 * Multi-select checkbox component with responsive behavior:
 * - Desktop: Always visible checkbox in left column
 * - Mobile/narrow: Icon by default, checkbox on hover or when checked
 * - Shows unread indicator when not checked
 */
export function MultiSelectCheckbox(props: MultiSelectCheckboxProps) {
  return (
    <button
      type="button"
      class="size-full relative group/button flex items-center justify-center"
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onChecked?.(!props.checked, e.shiftKey);
      }}
      data-blocks-navigation
    >
      <div
        class={cn(
          'size-4 p-0.5 flex items-center justify-center rounded-xs group-hover/button:border-accent group-hover/button:border pointer-events-none',
          {
            'bg-accent border border-accent': props.checked,
          }
        )}
      >
        <Show when={props.checked}>
          <CheckIcon class="size-full text-surface" />
        </Show>
      </div>
    </button>
  );
}
