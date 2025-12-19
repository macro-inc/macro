import type { JSXElement } from 'solid-js';

export interface DialogWrapperProps {
  children: JSXElement;
  class?: string;
  width?: string;
}

export function DialogWrapper(props: DialogWrapperProps) {
  const width = props.width ?? '800px';

  return (
    <div class="z-modal fixed inset-0 bg-modal-overlay pattern-edge-muted pattern-diagonal-4">
      <div
        style={{
          'max-width': 'calc(100vw - (var(--gutter-size) * 2))',
          margin: '160px auto 0 auto',
          'max-height': '75vh',
          overflow: 'hidden',
          width: width,
        }}
        class={props.class}
      >
        {props.children}
      </div>
    </div>
  );
}
