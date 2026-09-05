import { type Accessor, createContext, type JSX, useContext } from 'solid-js';

type LayerDepth = 0 | 1 | 2 | 3 | 4;

type LayerProps = {
  children?: JSX.Element;
  depth?: LayerDepth;
  offset?: number;
};

const LayerContext = createContext<Accessor<LayerDepth>>((): LayerDepth => 0);

function clampDepth(depth: number): LayerDepth {
  return Math.min(4, Math.max(0, depth)) as LayerDepth;
}

/** Marks a subtree with an absolute or parent-relative surface depth. */
export function Layer(props: LayerProps) {
  const parentDepth = useContext(LayerContext);
  const depth = () =>
    clampDepth((props.depth ?? parentDepth()) + (props.offset ?? 0));

  return (
    <LayerContext.Provider value={depth}>
      <div data-layer data-depth={depth()} style={{ display: 'contents' }}>
        {props.children}
      </div>
    </LayerContext.Provider>
  );
}
