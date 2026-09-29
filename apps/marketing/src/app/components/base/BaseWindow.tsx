import type { JSX, ParentProps } from 'solid-js';

interface WindowProps extends ParentProps {
  header?: JSX.Element;
}

export function BaseWindow(props: WindowProps) {
  return (
    <div
      style={{
        'overscroll-behavior': 'none',
        'box-sizing': 'border-box',
        'scrollbar-width': 'none',
        'overflow-y': 'scroll',
        // Divide out the large-desktop html zoom (--site-scale) — viewport
        // units are not scaled by `zoom`, so plain 100vw/100dvh would render
        // 10% larger than the screen.
        height: 'calc(100dvh / var(--site-scale, 1))',
        width: 'calc(100vw / var(--site-scale, 1))',
      }}
    >
      {props.children}
    </div>
  );
}
