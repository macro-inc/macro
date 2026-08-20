import type { JSX } from 'solid-js';

type LayerProps = {
  children?: JSX.Element;
  depth?: 0 | 1 | 2 | 3 | 4;
};

/** Marks a subtree with its surface depth. CSS owns all layer semantics. */
export function Layer(props: LayerProps) {
  return (
    <div
      data-layer
      data-depth={props.depth ?? 0}
      style={{ display: 'contents' }}
    >
      {props.children}
    </div>
  );
}
