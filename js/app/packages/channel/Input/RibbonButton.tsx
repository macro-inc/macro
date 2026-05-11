import { Button } from '@ui';
import type { JSX } from 'solid-js';

type RibbonButtonProps = {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: JSX.Element;
};

export function RibbonButton(props: RibbonButtonProps) {
  return (
    <Button
      aria-label={props.label}
      title={props.label}
      variant={props.active ? 'active' : 'ghost'}
      size="icon-md"
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onClick();
      }}
    >
      {props.children}
    </Button>
  );
}
