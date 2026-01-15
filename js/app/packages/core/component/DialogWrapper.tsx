import type { JSXElement, Ref } from 'solid-js';

export interface DialogWrapperProps {
  children: JSXElement;
  class?: string;
  width?: string;
  overlayRef?: Ref<HTMLDivElement>;
  contentRef?: Ref<HTMLDivElement>;
}

export function DialogWrapper(props: DialogWrapperProps) {
  const width = props.width ?? '800px';

  return (
    <div
      class="z-modal fixed inset-0 bg-modal-overlay pattern-edge-muted pattern-diagonal-4"
      ref={props.overlayRef}
    >
      <div
        class={`max-w-[calc(100vw-16px)] mt-20 sm:mt-40 mx-auto max-h-[75vh] overflow-hidden ${props.class ?? ''}`}
        style={{ width: width }}
        ref={props.contentRef}
      >
        {props.children}
      </div>
    </div>
  );
}
