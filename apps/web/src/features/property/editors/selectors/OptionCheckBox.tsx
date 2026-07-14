import { Checkbox } from '@ui';
import type { Component } from 'solid-js';

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
    <Checkbox
      checked={props.checked}
      onChange={() => undefined}
      class="shrink-0"
    >
      <Checkbox.Control
        class={`size-3.5 border-transparent bg-transparent hover:border-accent data-checked:bg-accent data-checked:border-accent ${
          props.checked ? '' : 'group-hover:not-hover:border-edge-muted'
        } ${props.multiselect === false ? 'rounded-full' : 'rounded-sm'}`}
      />
    </Checkbox>
  );
};
