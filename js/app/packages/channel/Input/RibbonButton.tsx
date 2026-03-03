import type { JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

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
        'flex flex-col items-center justify-center h-[28px] w-[28px] hover:bg-hover hover-transition-bg rounded-md',
        {
          'bg-active': props.active,
        }
      )}
      onClick={(event) => {
        event.preventDefault();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}
