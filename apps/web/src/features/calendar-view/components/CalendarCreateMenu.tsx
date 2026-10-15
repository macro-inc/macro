import { Button, type ButtonProps, type ButtonSize, Dropdown } from '@ui';
import type { Component, JSX } from 'solid-js';

/** Menu presentation; consumers compose its trigger and creation items. */
export function CalendarCreateMenu(props: {
  trigger: JSX.Element;
  as?: Component<ButtonProps>;
  children: JSX.Element;
  class?: string;
  contentClass?: string;
  size?: ButtonSize;
  variant?: ButtonProps['variant'];
  label?: string;
}) {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        as={props.as ?? Button}
        variant={props.variant}
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
