import type { JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useMobileChannelInputVisibility } from '@channel/Channel/mobile-channel-input-visibility';

export function ChannelInputContainer(props: {
  ref: (el: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  const visibility = useMobileChannelInputVisibility();
  return (
    <div
      class={cn(
        'pb-2 w-full flex justify-center [&_[data-input-editor-shell]]:max-h-[calc(60*var(--dvh,1dvh))] mobile:[&_[data-input-editor-shell]]:max-h-[calc(32*var(--dvh,1dvh))]',
        visibility?.isHidden() && 'hidden'
      )}
      ref={props.ref}
    >
      {props.children}
    </div>
  );
}
