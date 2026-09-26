import { type ButtonSize, Dropdown } from '@ui';
import type { JSX } from 'solid-js';

/** Menu presentation; consumers compose its trigger and creation items. */
export function CalendarCreateMenu(props: {
  trigger: JSX.Element;
  children: JSX.Element;
  class?: string;
  contentClass?: string;
  size?: ButtonSize;
  label?: string;
}) {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        size={props.size ?? 'sm'}
        class={props.class}
        label={props.label}
      >
        {props.trigger}
      </Dropdown.Trigger>
      <Dropdown.Content class={props.contentClass ?? 'min-w-40'}>
        <Dropdown.Group>{props.children}</Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
