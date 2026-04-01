import type { JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

export function ChannelInputContainer(props: {
  ref: (el: HTMLDivElement) => void;
  children: JSX.Element;
  isHidden?: boolean;
}) {
  return (
    <div
      class={cn('pb-2 w-full flex justify-center', props.isHidden && 'hidden')}
      ref={props.ref}
    >
      {props.children}
    </div>
  );
}
