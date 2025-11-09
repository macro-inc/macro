import { createCallback } from '@solid-primitives/rootless';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  DRAG_THRESHOLD,
  type Edge,
  Edges,
  HANDLE_SIZE,
  type RenderMode,
  Tools,
} from '../../constants';
import type { CanvasNode } from '../../model/CanvasModel';
import { type ConnectOperator, useConnect } from '../../operation/connect';
import { useMove } from '../../operation/move';
import { useSelect } from '../../operation/select';
import { useSelection } from '../../signal/selection';
import { useToolManager } from '../../signal/toolManager';
import { useRenderState } from '../../store/RenderState';
import { Rect } from '../../util/rectangle';
import { getBorderRadius, getTailwindColor } from '../../util/style';
import { type Vector2, vec2 } from '../../util/vector2';
import { LayerContext } from '../LayerContext';

function edgeToPosition(edge: Edge, size: number): Partial<JSX.CSSProperties> {
  switch (edge) {
    case Edges.Top:
      return {
        top: -size / 2 + 'px',
        left: 0,
        width: '100%',
        height: size + 'px',
      };
    case Edges.Right:
      return {
        top: 0,
        right: -size / 2 + 'px',
        width: size + 'px',
        height: '100%',
      };
    case Edges.Bottom:
      return {
        bottom: -size / 2 + 'px',
        left: 0,
        width: '100%',
        height: size + 'px',
      };
    case Edges.Left:
      return {
        top: 0,
        left: -size / 2 + 'px',
        width: size + 'px',
        height: '100%',
      };
  }
}

function EdgeHandle(props: {
  id: string;
  edge: Edge;
  scale: Accessor<number>;
}) {
  const position = () =>
    edgeToPosition(props.edge, (HANDLE_SIZE * 2) / props.scale());
  const { selectedTool } = useToolManager();
  const connect = useConnect() as ConnectOperator;
  const [hover, setHover] = createSignal(false);

  return (
    <div
      style={{
        position: 'absolute',
        ...position(),
      }}
      classList={{
        'bg-ink-muted/60': hover(),
      }}
      onPointerDown={createCallback((e: PointerEvent) => {
        if (selectedTool() === Tools.Line) {
          e.preventDefault();
          e.stopPropagation();
          connect.reset();
          connect.start(e, { node: props.id, side: props.edge });
        }
      })}
      onPointerEnter={createCallback(() => {
        if (selectedTool() === Tools.Line) {
          setHover(true);
          connect.setDropTarget({ node: props.id, side: props.edge });
        }
      })}
      onPointerLeave={createCallback(() => {
        setHover(false);
        if (selectedTool() === Tools.Line) {
          connect.setDropTarget();
        }
      })}
    />
  );
}

interface BaseCanvasRectangleProps {
  node: CanvasNode;
  mode: RenderMode;
  children?: JSX.Element;
  onDragStart?: (e: PointerEvent) => void;
  onDragMove?: (e: PointerEvent) => void;
  onDragEnd?: () => void;
  showEdgeHandles?: boolean;
  clickable?: boolean;

  useSimpleSelectionBox?: boolean; //use a box with sharp corners and a fixed width
}

export function BaseCanvasRectangle(props: BaseCanvasRectangleProps) {
  const layerContext = useContext(LayerContext);

  const { selectNode, selectGroup, isSelected, deselectAll } = useSelection();
  const { currentScale, defferedScale } = useRenderState();
  const { activeTool, setSelectedTool, ignore } = useToolManager();

  const move = useMove();
  const select = useSelect();

  // Calculate normalized dimensions
  const rect = createMemo(() => {
    return Rect.fromCanvasNode(props.node).toCssRect();
  });

  const borderRadius = createMemo(() => ({
    'border-radius': getBorderRadius(props.node),
  }));

  const isLineTool = createMemo(() => activeTool() === Tools.Line);

  const [dragStartPos, setDragStartPos] = createSignal<Vector2>();
  const [dragActive, setDragActive] = createSignal(false);

  const start = (e: PointerEvent) => {
    if (activeTool() !== Tools.Select) return;
    setDragStartPos(vec2(e.pageX, e.pageY));
    setDragActive(false);

    if (!e.shiftKey && !isSelected(props.node.id)) {
      deselectAll();
    }
    selectNode(props.node.id);
    if (props.node.groupId) selectGroup(props.node.groupId);
    select.abort();
    props.onDragStart?.(e);
  };

  const drag = (e: PointerEvent) => {
    if (dragActive()) return;
    const pos = dragStartPos();
    if (pos === undefined) return;
    if (isSelected(props.node.id) && dragStartPos() !== undefined) {
      if (pos.distance(vec2(e.pageX, e.pageY)) > DRAG_THRESHOLD) {
        select.abort();
        setSelectedTool(Tools.Move);
        move.start(e);
        setDragActive(true);
        props.onDragMove?.(e);
      }
    }
  };

  const end = () => {
    setDragStartPos();
    setDragActive(false);
    props.onDragEnd?.();
  };

  onMount(() => {
    document.addEventListener('pointermove', drag);
    document.addEventListener('pointerup', end);
  });

  onCleanup(() => {
    document.removeEventListener('pointermove', drag);
    document.removeEventListener('pointerup', end);
  });

  const selectionStyle = createMemo((): Partial<JSX.CSSProperties> => {
    if (props.useSimpleSelectionBox === false) {
      const shapeStrokeWidth = props.node.style?.strokeWidth ?? 2;
      const outlineWidth = 1 / currentScale();
      const outlineOffset = -shapeStrokeWidth / 2 - outlineWidth;
      return {
        'border-radius': `${getBorderRadius(props.node)}`,
        outline: `${outlineWidth}px solid ${getTailwindColor('sky-500')}`,
        'outline-offset': `${outlineOffset}px`,
        visibility: isSelected(props.node.id) ? 'visible' : 'hidden',
      };
    } else {
      return {
        'border-radius': `0px`,
        outline: `${1 / currentScale()}px solid ${getTailwindColor('sky-500')}`,
        'outline-offset': `-1px`, //i think
        visibility: isSelected(props.node.id) ? 'visible' : 'hidden',
      };
    }
  });

  return (
    <>
      <div
        class="absolute top-0 left-0 box-border"
        style={{ ...rect(), ...borderRadius() }}
        onPointerDown={(e) => {
          if (props.clickable) {
            if (e.button !== 0 || ignore(e)) return;
            e.stopPropagation();
            start(e);
          }
        }}
      >
        <div class="h-full pointer-events-none">{props.children}</div>
      </div>

      <Portal mount={layerContext().selection}>
        <div
          class={`absolute pointer-events-none top-0 left-0 opacity-90 border-opacity-100 outline-accent outline-1`}
          style={{
            // TODO
            ...rect(),
            ...selectionStyle(), // So here *everything* takes the selection style, even text boxes
          }}
        />
      </Portal>

      <div
        class="absolute top-0 left-0 border-transparent opacity-40 z-user-highlight"
        style={{
          ...rect(),
          ...borderRadius(),
          'pointer-events': isLineTool() ? 'auto' : 'none',
        }}
      >
        <EdgeHandle id={props.node.id} edge={Edges.Top} scale={defferedScale} />
        <EdgeHandle
          id={props.node.id}
          edge={Edges.Right}
          scale={defferedScale}
        />
        <EdgeHandle
          id={props.node.id}
          edge={Edges.Bottom}
          scale={defferedScale}
        />
        <EdgeHandle
          id={props.node.id}
          edge={Edges.Left}
          scale={defferedScale}
        />
      </div>
    </>
  );
}
