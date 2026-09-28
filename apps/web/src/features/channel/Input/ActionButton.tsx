import { Button, cn } from '@ui';
import type { JSX } from 'solid-js';

export function InputActionButton(props: {
  label: string;
  onClick?: (event: MouseEvent) => void;
  active?: boolean;
  disabled?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <Button
      aria-label={props.label}
      label={props.label}
      disabled={props.disabled}
      variant={props.active ? 'accent' : 'ghost'}
      size="icon-composer"
      class={cn('rounded-full touch:size-6', props.class)}
      onPointerDown={(event: PointerEvent) => event.preventDefault()}
      onClick={(event) => props.onClick?.(event)}
    >
      {props.children}
    </Button>
  );
}
