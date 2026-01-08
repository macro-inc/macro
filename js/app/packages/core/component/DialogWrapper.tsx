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
        style={{
          'max-width': 'calc(100vw - (var(--gutter-size) * 2))',
          margin: '160px auto 0 auto',
          'max-height': '75vh',
          overflow: 'hidden',
          width: width,
        }}
        class={props.class}
        ref={props.contentRef}
      >
        {props.children}
      </div>
    </div>
  );
}
