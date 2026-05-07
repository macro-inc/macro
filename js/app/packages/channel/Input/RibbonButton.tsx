import { cn } from '@ui';
import type { JSX } from 'solid-js';

type RibbonButtonProps = {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: JSX.Element;
};

export function RibbonButton(props: RibbonButtonProps) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      class={cn(
        'flex flex-col items-center justify-center size-7 hover:bg-hover hover-transition-bg rounded-md',
        {
          'bg-active': props.active,
        }
      )}
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}
