import CheckIcon from '@icon/bold/check-bold.svg';
import { type Component, Show } from 'solid-js';

/**
 * CheckBox component for property option menus.
 * @param props.checked Show the box as checked or not
 * @param props.multiselect Show the box as a regular-multi-selectable checkbox
 *     or if explicitly false, as a rounded radio button.
 * @returns
 */
export const OptionCheckBox: Component<{
  checked: boolean;
  multiselect?: boolean;
}> = (props) => {
  return (
    <div
      class="size-4 flex items-center justify-center"
      classList={{
        'bg-accent border-accent border': props.checked,
        'bg-transparent border-edge-muted border': !props.checked,
        'rounded-full': props.multiselect === false,
      }}
    >
      <Show when={props.checked && props.multiselect !== false}>
        <CheckIcon class="size-3 text-panel" />
      </Show>
    </div>
  );
};
