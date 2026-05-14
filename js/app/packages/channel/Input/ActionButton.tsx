import { Button } from '@ui';
import type { JSX } from 'solid-js';

export function InputActionButton(props: {
  label: string;
  onClick?: (event: MouseEvent) => void;
  active?: boolean;
  children: JSX.Element;
}) {
  return (
    <Button
      title={props.label}
      aria-label={props.label}
      label={props.label}
      variant={props.active ? 'active' : 'ghost'}
      size="icon-md"
      onPointerDown={(event: PointerEvent) => event.preventDefault()}
      onClick={(event) => props.onClick?.(event)}
    >
      {props.children}
    </Button>
  );
}
