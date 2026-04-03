import type { JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

export function ChannelInputContainer(props: {
  ref: (el: HTMLDivElement) => void;
  children: JSX.Element;
  isHidden?: boolean;
}) {
  return (
    <div
      class={cn(
        'pb-2 mobile:pb-0 w-full flex justify-center [&_[data-input-editor-shell]]:max-h-[calc(60*var(--dvh,1dvh))] mobile:[&_[data-input-editor-shell]]:max-h-[calc(32*var(--dvh,1dvh))]',
        props.isHidden && 'hidden'
      )}
      ref={props.ref}
    >
      {props.children}
    </div>
  );
}
