import type { ParentProps } from 'solid-js';

export function UtilFrame(props: ParentProps) {
  return (
    <div
      style={{
        border: '1px solid var(--b4)',
        'border-radius': '5px',
        overflow: 'clip',
      }}
    >
      {props.children}
    </div>
  );
}
