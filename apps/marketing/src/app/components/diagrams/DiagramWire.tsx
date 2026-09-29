import { createEffect, createSignal, onCleanup } from 'solid-js';
import { createVisible } from '../../utils/utilVisible';

interface DiagramWireProps {
  start?: 'top' | 'left' | 'bottom' | 'right';
  from: string;
  to: string;
  color?: string;
  opacity?: number;
  strokeWidth?: number;
}

type AnchorType = DiagramWireProps['start'];

function getStartAnchorPoint(
  rect: DOMRect,
  anchor: AnchorType = 'bottom'
): { x: number; y: number } {
  const { top, left, width, height } = rect;

  switch (anchor) {
    case 'bottom':
      return { x: left + width / 2, y: top + height + 20 };
    case 'right':
      return { x: left + width + 20, y: top + height / 2 };
    case 'left':
      return { x: left - 20, y: top + height / 2 };
    case 'top':
      return { x: left + width / 2, y: top - 20 };
  }
}

function getEndAnchorPoint(rect: DOMRect): { x: number; y: number } {
  const { top, left, width, height } = rect;
  return { x: left + width / 2, y: top + height / 2 };
}

function isHorizontalAnchor(anchor: AnchorType): boolean {
  return anchor === 'left' || anchor === 'right';
}

function getStepPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  start: AnchorType = 'bottom'
): string {
  const verticalFirst = !isHorizontalAnchor(start);
  if (verticalFirst) {
    const dx = Math.abs(x2 - x1);
    let midY = (y1 + y2) / 2;
    const dyDiagonal = Math.abs(y2 - midY);
    if (dx < dyDiagonal) {
      midY = y2 > y1 ? y2 - dx : y2 + dx;
    }
    return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${y2}`;
  } else {
    const dy = Math.abs(y2 - y1);
    let midX = (x1 + x2) / 2;
    const dxDiagonal = Math.abs(x2 - midX);
    if (dy < dxDiagonal) {
      midX = x2 > x1 ? x2 - dy : x2 + dy;
    }
    return `M ${x1} ${y1} L ${midX} ${y1} L ${x2} ${y2}`;
  }
}

export function DiagramWire(props: DiagramWireProps) {
  let svgRef: SVGSVGElement | undefined;

  const [x1, setX1] = createSignal<number | null>(null);
  const [y1, setY1] = createSignal<number | null>(null);
  const [x2, setX2] = createSignal<number | null>(null);
  const [y2, setY2] = createSignal<number | null>(null);

  const visible = createVisible(() => svgRef);

  // Wires track anchors that wobble with the parent scene every frame, so
  // they poll per frame — but only while the wire is near the viewport.
  createEffect(() => {
    if (!visible()) return;
    let rafId: number;

    function pollPositions() {
      const fromEl = document.getElementById(props.from);
      const toEl = document.getElementById(props.to);
      const container = svgRef?.parentElement;

      if (!fromEl || !toEl || !container) {
        setX1(null);
        setY1(null);
        setX2(null);
        setY2(null);
      } else {
        const { left: offsetX, top: offsetY } =
          container.getBoundingClientRect();
        const fromPoint = getStartAnchorPoint(
          fromEl.getBoundingClientRect(),
          props.start
        );
        const toPoint = getEndAnchorPoint(toEl.getBoundingClientRect());

        setX1(fromPoint.x - offsetX);
        setY1(fromPoint.y - offsetY);
        setX2(toPoint.x - offsetX);
        setY2(toPoint.y - offsetY);
      }

      rafId = requestAnimationFrame(pollPositions);
    }

    rafId = requestAnimationFrame(pollPositions);

    onCleanup(() => {
      cancelAnimationFrame(rafId);
    });
  });

  function renderPath() {
    const px1 = x1(),
      py1 = y1(),
      px2 = x2(),
      py2 = y2();
    if (px1 === null || py1 === null || px2 === null || py2 === null)
      return null;

    const d = getStepPath(px1, py1, px2, py2, props.start);
    const color = props.color ?? 'var(--c0)';
    const opacity = props.opacity ?? 1;

    return (
      <g opacity={opacity}>
        <path
          stroke-width={props.strokeWidth ?? 1.6}
          stroke={color}
          fill="none"
          d={d}
        />
        <rect
          x={px1 - 3}
          y={py1 - 3}
          width={6}
          height={6}
          rx={1}
          ry={1}
          fill={color}
          transform={`rotate(45 ${px1} ${py1})`}
        />
        <rect
          x={px2 - 3}
          y={py2 - 3}
          width={6}
          height={6}
          rx={1}
          ry={1}
          fill={color}
          transform={`rotate(45 ${px2} ${py2})`}
        />
      </g>
    );
  }

  return (
    <svg
      style={{
        'pointer-events': 'none',
        position: 'absolute',
        overflow: 'visible',
        inset: '0',
      }}
      ref={svgRef}
    >
      {renderPath()}
    </svg>
  );
}
