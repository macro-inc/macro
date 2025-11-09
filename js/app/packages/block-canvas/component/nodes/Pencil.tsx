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
  DRAG_THRESHOLD,
  type RenderMode,
  RenderModes,
  Tools,
} from '../../constants';
import type { PencilNode } from '../../model/CanvasModel';
import { useMove } from '../../operation/move';
import { useSelect } from '../../operation/select';
import { useSelection } from '../../signal/selection';
import { useToolManager } from '../../signal/toolManager';
import { useRenderState } from '../../store/RenderState';
import { getTailwindColor } from '../../util/style';
import { type Vector2, vec2 } from '../../util/vector2';
import { LayerContext } from '../LayerContext';

export function Pencil(props: { node: PencilNode; mode: RenderMode }) {
  const layerContext = useContext(LayerContext);
  const { selectNode, isSelected, deselectAll } = useSelection();
  const { setSelectedTool, activeTool } = useToolManager();
  const move = useMove();
  const select = useSelect();
  const { currentScale } = useRenderState();

  const [dragStartPos, setDragStartPos] = createSignal<Vector2>();
  const [dragActive, setDragActive] = createSignal(false);

  const pointerdown = (e: PointerEvent) => {
    if (activeTool() !== Tools.Select) return;
    setDragStartPos(vec2(e.pageX, e.pageY));
    setDragActive(false);
    e.stopPropagation();

    if (!e.shiftKey && !isSelected(props.node.id)) {
      deselectAll();
    }
    select.abort();
    selectNode(props.node.id);
  };

  const pointermove = (e: PointerEvent) => {
    if (dragActive()) return;
    const pos = dragStartPos();
    if (pos === undefined) return;
    if (isSelected(props.node.id) && dragStartPos() !== undefined) {
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

  const x = createMemo(() => props.node.x ?? 0);
  const y = createMemo(() => props.node.y ?? 0);
  const wScale = createMemo(() => props.node.wScale ?? 1);
  const hScale = createMemo(() => props.node.hScale ?? 1);

  const pathStyle = createMemo(
    (): Partial<JSX.SvgSVGAttributes<SVGPathElement>> => {
      const fallbackColor = getTailwindColor('gray-700');
      const strokeColor = props.node.style?.strokeColor ?? fallbackColor;

      const strokeWidth =
        props.mode === RenderModes.Selection
          ? 1 / currentScale()
          : (props.node.style?.strokeWidth ?? 2);

      return {
        stroke: strokeColor,
        'stroke-width': `${strokeWidth}px`,
      };
    }
  );
  const selectedPathStyle = createMemo(
    (): Partial<JSX.SvgSVGAttributes<SVGPathElement>> => {
      const strokeColor =
        props.mode === RenderModes.Preview
          ? 'transparent'
          : getTailwindColor('sky-500');
      const strokeWidth = 1 / currentScale();
      return {
        stroke: strokeColor,
        'stroke-width': `${strokeWidth}px`,
      };
    }
  );

  const path = createMemo(() => {
    const points = props.node.coords;
    if (!points?.length) return '';

    // Start with move command
    let d = `M ${points[0].join(' ')}`;

    // For n points, we can make n-1 curves
    for (let i = 1; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      d += ` Q ${x0} ${y0}, ${(x0 + x1) / 2} ${(y0 + y1) / 2}`;
    }

    // Draw the final segment if we have more than one point
    if (points.length > 1) {
      const lastPoint = points[points.length - 1];
      d += ` L ${lastPoint.join(' ')}`;
    }

    return d;
  });

  return (
    <>
      <div class={`absolute top-0 left-0`} onPointerDown={pointerdown}>
        <svg width="10px" height="10px" class="overflow-visible">
          <g
            transform={`translate(${x()} ${y()}) scale(${wScale()} ${hScale()})`}
          >
            {/* render a thick but transparent line for easier mouse selection */}
            <path
              d={path()}
              stroke-width={20 / currentScale()}
              stroke={'transparent'}
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
              fill="none"
            />
            {/* Main visible Path */}
            <path
              d={path()}
              stroke-width={pathStyle()['stroke-width']}
              stroke={pathStyle()['stroke']}
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
              fill="none"
            />
          </g>
        </svg>
      </div>
      <Portal mount={layerContext().selection}>
        <div class={`absolute top-0 left-0`}>
          <svg width="10px" height="10px" class="overflow-visible">
            <g
              transform={`translate(${x()} ${y()}) scale(${wScale()} ${hScale()})`}
            >
              <path
                d={path()}
                stroke-width={selectedPathStyle()['stroke-width']}
                stroke={selectedPathStyle()['stroke']}
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
                fill="none"
                visibility={isSelected(props.node.id) ? 'visible' : 'hidden'}
              />
            </g>
          </svg>
        </div>
      </Portal>
    </>
  );
}
