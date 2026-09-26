import type { JSX, ParentProps } from 'solid-js';

export function DiagramWrapper(
  props: ParentProps<{ style?: JSX.CSSProperties }>
) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        'z-index': 0,
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}
