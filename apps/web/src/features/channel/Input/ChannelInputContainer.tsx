import type { JSX } from 'solid-js';

export function ChannelInputContainer(props: {
  ref?: (el: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  return (
    <div
      class="pb-2 touch:pb-0 w-full flex justify-center **:data-input-editor-shell:max-h-[calc(60*var(--dvh,1dvh))] mobile:**:data-input-editor-shell:max-h-[calc(32*var(--dvh,1dvh))] touch:px-(--mobile-chrome-gutter) touch:pointer-events-auto"
      ref={props.ref}
    >
      {props.children}
    </div>
  );
}
