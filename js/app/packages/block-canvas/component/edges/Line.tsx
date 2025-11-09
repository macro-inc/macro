import { edgeToRenderData } from '@block-canvas/util/connectors';
import { createCallback } from '@solid-primitives/rootless';
import {
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  ARROW_SIZE,
  DRAG_THRESHOLD,
  type RenderMode,
  RenderModes,
  Tools,
} from '../../constants';
import type { CanvasEdge } from '../../model/CanvasModel';
import { useConnect } from '../../operation/connect';
import { useMove } from '../../operation/move';
import { useSelect } from '../../operation/select';
import { useSelection } from '../../signal/selection';
import { useToolManager } from '../../signal/toolManager';
import { useEdgeUtils } from '../../store/canvasData';
import { useRenderState } from '../../store/RenderState';
import { getTailwindColor } from '../../util/style';
import { type Vector2, vec2 } from '../../util/vector2';
import { LayerContext } from '../LayerContext';
import { ArrowHead } from './Arrows';

export function Line(props: { edge: CanvasEdge; mode: RenderMode }) {
  const layerContext = useContext(LayerContext);
  const { selectEdge, selectGroup, isSelected, deselectAll } = useSelection();
  const { activeTool, setSelectedTool } = useToolManager();
  const { currentScale } = useRenderState();
  const move = useMove();
  const select = useSelect();
  const connect = useConnect();
  const { getRawEndPoints } = useEdgeUtils();

  const [dragStartPos, setDragStartPos] = createSignal<Vector2>();
  const [dragActive, setDragActive] = createSignal(false);

  const pointerdown = createCallback((e: MouseEvent) => {
    if (activeTool() !== Tools.Select) return;
    setDragStartPos(vec2(e.pageX, e.pageY));
    setDragActive(false);
    e.stopPropagation();
    if (!e.shiftKey && !isSelected(props.edge.id)) {
      deselectAll();
    }
    select.abort();
    selectEdge(props.edge.id);
    if (props.edge.groupId) selectGroup(props.edge.groupId);
  });

  const pointermove = (e: PointerEvent) => {
    if (dragActive()) return;
    const pos = dragStartPos();
    if (pos === undefined) return;
    if (isSelected(props.edge.id) && dragStartPos() !== undefined) {
      if (pos.distance(vec2(e.pageX, e.pageY)) > DRAG_THRESHOLD) {
        select.abort();
        setSelectedTool(Tools.Move);
        move.start(e);
        setDragActive(true);
      }
    }
  };

  const pointerup = () => {
    setDragStartPos();
    setDragActive(false);
  };

  onMount(() => {
    document.addEventListener('pointermove', pointermove);
    document.addEventListener('pointerup', pointerup);
  });

  onCleanup(() => {
    document.removeEventListener('pointermove', pointermove);
    document.removeEventListener('pointerup', pointerup);
  });

  const endPoints = createMemo(() => getRawEndPoints(props.edge));
  const edgeRenderData = createMemo(() =>
    edgeToRenderData(props.edge, [endPoints().from, endPoints().to])
  );

  // While connection is active, we have to pass through pointer events
  // to the connection drop listeners on shapes.
  const pointerEvents = createMemo(() => {
    if (connect.active()) {
      return 'none';
    }
    return 'visiblePainted';
  });

  const lineStyle = createMemo(
    (): Partial<JSX.SvgSVGAttributes<SVGLineElement>> => {
      const fallbackColor = getTailwindColor('gray-700');
      const selected = props.mode === RenderModes.Selection;
      const strokeColor = selected
        ? getTailwindColor('sky-500')
        : (props.edge.style?.strokeColor ?? fallbackColor);
      const strokeWidth =
        props.mode === RenderModes.Selection
          ? 1 / currentScale()
          : (props.edge.style?.strokeWidth ?? 2);
      return {
        stroke: strokeColor,
        'stroke-width': `${strokeWidth}px`,
        'stroke-linecap': 'round',
      };
    }
  );

  const handleSize = createMemo(() => 12 / currentScale());

  // Calculate the angle of the base line
  const arrowLength = () => ARROW_SIZE;
  const arrowStyle = () => ({
    stroke: lineStyle().stroke,
    'stroke-width': lineStyle()['stroke-width'],
  });

  const path = () => {
    return edgeRenderData().path;
  };

  return (
    <>
      <div class={`absolute top-0 left-0 opacity-90 pointer-events-none`}>
        <svg
          width="10px"
          height="10px"
          class="overflow-visible"
          pointer-events="none"
        >
          {/* render a thick but transparent line for easier mouse selection */}
          <path
            d={path()}
            fill="none"
            stroke="transparent"
            stroke-width={20 / currentScale()}
            stroke-linecap={lineStyle()['stroke-linecap']}
            vector-effect="non-scaling-stroke"
            pointer-events={pointerEvents()}
            on:pointerdown={pointerdown}
          />
          <path
            d={path()}
            fill="none"
            stroke={lineStyle().stroke}
            stroke-width={lineStyle()['stroke-width']}
            stroke-linecap={lineStyle()['stroke-linecap']}
            vector-effect="non-scaling-stroke"
            pointer-events={pointerEvents()}
            on:pointerdown={pointerdown}
          />
          <ArrowHead
            x={edgeRenderData().fromPos.x}
            y={edgeRenderData().fromPos.y}
            angle={edgeRenderData().fromVec.angle()}
            length={arrowLength()}
            style={arrowStyle()}
            arrowStyle={props.edge.style?.fromEndStyle}
            end="from"
            onPointerDown={pointerdown}
          />
          <ArrowHead
            x={edgeRenderData().toPos.x}
            y={edgeRenderData().toPos.y}
            angle={edgeRenderData().toVec.angle()}
            length={arrowLength()}
            style={arrowStyle()}
            arrowStyle={props.edge.style?.toEndStyle}
            end="to"
            onPointerDown={pointerdown}
          />
        </svg>
      </div>
      <Portal mount={layerContext().lineSelection}>
        <div class={`absolute top-0 left-0 pointer-events-none`}>
          <svg
            width="10px"
            height="10px"
            class="overflow-visible"
            pointer-events="none"
            visibility={isSelected(props.edge.id) ? 'visible' : 'hidden'}
          >
            <path
              d={path()}
              fill="none"
              stroke={getTailwindColor('sky-500')}
              stroke-width={`${1 / currentScale()}px`}
              stroke-linecap={lineStyle()['stroke-linecap']}
              vector-effect="non-scaling-stroke"
            />
            <circle
              cx={edgeRenderData().fromPos.x}
              cy={edgeRenderData().fromPos.y}
              r={handleSize() / 2}
              fill={getTailwindColor('gray-50')}
              stroke={getTailwindColor('sky-500')}
              stroke-width={`${1 / currentScale()}px`}
              pointer-events={pointerEvents()}
              onPointerDown={createCallback((e: PointerEvent) => {
                e.stopPropagation();
                move.abort();
                connect.abort();
                select.abort();
                setSelectedTool(Tools.Line);
                connect.start(e, { edge: props.edge, handle: 'from' });
              })}
            />
            <circle
              cx={edgeRenderData().toPos.x}
              cy={edgeRenderData().toPos.y}
              r={handleSize() / 2}
              fill={getTailwindColor('gray-50')}
              stroke={getTailwindColor('sky-500')}
              stroke-width={`${1 / currentScale()}px`}
              pointer-events={pointerEvents()}
              onPointerDown={createCallback((e: PointerEvent) => {
                e.stopPropagation();
                move.abort();
                connect.abort();
                select.abort();
                setSelectedTool(Tools.Line);
                connect.start(e, { edge: props.edge, handle: 'to' });
              })}
            />
          </svg>
        </div>
      </Portal>
    </>
  );
}
