import { createCallback } from '@solid-primitives/rootless';
import { createMemo, Show } from 'solid-js';
import {
  type Corner,
  Corners,
  type Edge,
  Edges,
  HANDLE_SIZE,
  SELECTION_PADDING,
  Tools,
} from '../constants';
import { useMove } from '../operation/move';
import { useRescale } from '../operation/rescale';
import { useSelect } from '../operation/select';
import { useSelection } from '../signal/selection';
import { useToolManager } from '../signal/toolManager';
import { useRenderState } from '../store/RenderState';
import { type Rectangle, rect } from '../util/rectangle';
import { vec2 } from '../util/vector2';

function cornerToPosition(corner: Corner, size: number) {
  const halfSize = size / 2;
  switch (corner) {
    case Corners.TopLeft:
      return {
        top: -halfSize + 'px',
        left: -halfSize + 'px',
      };
    case Corners.TopRight:
      return {
        top: -halfSize + 'px',
        right: -halfSize + 'px',
      };
    case Corners.BottomRight:
      return {
        bottom: -halfSize + 'px',
        right: -halfSize + 'px',
      };
    case Corners.BottomLeft:
      return {
        bottom: -halfSize + 'px',
        left: -halfSize + 'px',
      };
  }
}

function cornerToCursor(corner: Corner) {
  const { activeTool } = useToolManager();
  if (activeTool() === Tools.Grab) return 'grab';
  switch (corner) {
    case Corners.TopLeft:
      return 'var(--cursor-nwse-resize)';
    case Corners.TopRight:
      return 'var(--cursor-nesw-resize)';
    case Corners.BottomRight:
      return 'var(--cursor-nwse-resize)';
    case Corners.BottomLeft:
      return 'var(--cursor-nesw-resize)';
  }
}

function CornerHandle(props: {
  corner: Corner;
  size: number;
  scaleFactor: number;
}) {
  const safeSize = createMemo(() => {
    return Math.round(Math.max(props.size * props.scaleFactor, 2));
  });
  const position = createMemo(() => cornerToPosition(props.corner, safeSize()));
  const rescale = useRescale();
  const { setSelectedTool } = useToolManager();
  const move = useMove();
  const select = useSelect();
  return (
    <div
      class="absolute border-accent bg-panel"
      style={{
        cursor: cornerToCursor(props.corner),
        width: safeSize() + 'px',
        height: safeSize() + 'px',
        ...position(),
        'border-width': 1 * props.scaleFactor + 'px',
        'pointer-events': 'all',
      }}
      onPointerDown={createCallback((e: PointerEvent) => {
        move.abort();
        select.abort();
        setSelectedTool(Tools.Resize);
        rescale.start(e, props.corner);
      })}
    ></div>
  );
}

export function edgeToPosition(
  edge: Edge,
  size: number,
  scale: number,
  borderWidth: number
) {
  const scaledSize = size * scale;
  const offset = size - scaledSize;
  switch (edge) {
    case Edges.Top:
      return {
        top: offset - (HANDLE_SIZE + borderWidth) + 'px',
        left: -borderWidth + 'px',
        width: '100%',
        height: scaledSize + 'px',
      };
    case Edges.Right:
      return {
        top: -borderWidth + 'px',
        right: offset - (HANDLE_SIZE - borderWidth) + 'px',
        width: scaledSize + 'px',
        height: '100%',
      };
    case Edges.Bottom:
      return {
        bottom: offset - (HANDLE_SIZE - borderWidth) + 'px',
        left: -borderWidth + 'px',
        width: '100%',
        height: scaledSize + 'px',
      };
    case Edges.Left:
      return {
        top: -borderWidth + 'px',
        left: offset - (HANDLE_SIZE + borderWidth) + 'px',
        width: scaledSize + 'px',
        height: '100%',
      };
  }
}

export function edgeToCursor(edge: Edge) {
  const { activeTool } = useToolManager();
  if (activeTool() === Tools.Grab) return 'grab';

  switch (edge) {
    case Edges.Top:
      return 'var(--cursor-ns-resize)';
    case Edges.Right:
      return 'var(--cursor-ew-resize)';
    case Edges.Bottom:
      return 'var(--cursor-ns-resize)';
    case Edges.Left:
      return 'var(--cursor-ew-resize)';
  }
}

function EdgeHandle(props: { edge: Edge; size: number; scaleFactor: number }) {
  const position = () =>
    edgeToPosition(props.edge, props.size, props.scaleFactor, 0);
  const { selectedTool, setSelectedTool } = useToolManager();
  const rescale = useRescale();
  const move = useMove();
  const select = useSelect();

  return (
    <div
      class="hover:bg-accent/20"
      style={{
        position: 'absolute',
        ...position(),
        cursor: edgeToCursor(props.edge),
        'pointer-events': 'all',
      }}
      onPointerDown={createCallback((e: PointerEvent) => {
        if (selectedTool() === Tools.Select) {
          select.abort();
          move.abort();
          setSelectedTool(Tools.Resize);
          rescale.start(e, props.edge);
        }
      })}
    ></div>
  );
}

export function SelectionRenderer() {
  const { selectionBounds, selectedNodes, selectedEdges } = useSelection();
  const { currentScale } = useRenderState();
  const select = useSelect();
  const bounds = createMemo(() => selectionBounds());
  const show = createMemo(() => {
    const b = bounds();
    if (b === undefined) return false;
    if (b.width === 0 && b.height === 0) return false;
    if (selectedNodes().length === 0) {
      if (selectedEdges().length === 1) {
        return false;
      }
    }
    return (
      (selectedTool() === Tools.Select && !select.active()) ||
      selectedTool() === Tools.Resize ||
      selectedTool() === Tools.Move
    );
  });

  const { selectedTool } = useToolManager();

  const position = createMemo<Rectangle>(() => {
    return bounds() ?? rect(vec2(0, 0), vec2(0, 0));
  });

  const computedProps = createMemo(() => ({
    size: HANDLE_SIZE,
    scaleFactor: 1 / currentScale(),
  }));

  return (
    <Show when={show()}>
      <div
        class="absolute border-accent z-50 top-0 left-0"
        style={{
          width: position().width + 2 * SELECTION_PADDING + 'px',
          height: position().height + 2 * SELECTION_PADDING + 'px',
          transform: `translate(${position().x - SELECTION_PADDING}px, ${position().y - SELECTION_PADDING}px)`,
          'border-width': 2 / currentScale() + 'px',
          'pointer-events': 'none',
        }}
      >
        <EdgeHandle edge={Edges.Top} {...computedProps()} />
        <EdgeHandle edge={Edges.Right} {...computedProps()} />
        <EdgeHandle edge={Edges.Bottom} {...computedProps()} />
        <EdgeHandle edge={Edges.Left} {...computedProps()} />
        <CornerHandle corner={Corners.TopLeft} {...computedProps()} />
        <CornerHandle corner={Corners.TopRight} {...computedProps()} />
        <CornerHandle corner={Corners.BottomRight} {...computedProps()} />
        <CornerHandle corner={Corners.BottomLeft} {...computedProps()} />
      </div>
    </Show>
  );
}
