import type { JSX } from 'solid-js';

export function ChannelInputContainer(props: {
  ref?: (el: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  return (
    <div
      class="pb-2 mobile:pb-0 w-full flex justify-center **:data-input-editor-shell:max-h-[calc(60*var(--dvh,1dvh))] mobile:**:data-input-editor-shell:max-h-[calc(32*var(--dvh,1dvh))] mobile:px-(--mobile-chrome-gutter) mobile:pointer-events-auto"
      ref={props.ref}
    >
      {props.children}
    </div>
  );
}
