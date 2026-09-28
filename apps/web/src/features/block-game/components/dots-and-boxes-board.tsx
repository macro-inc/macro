import { createMemo, For, Show } from 'solid-js';
import type {
  DotsAndBoxesMove,
  DotsAndBoxesState,
  DotsEdgeKind,
} from '../core/games/dots-and-boxes';
import { seatColor, seatTint } from './seat-color';

const SPACING = 56;
const MARGIN = 14;
/** Thickness of the invisible target around each undrawn line. */
const HIT_BAND = 18;

type Edge = {
  edge: DotsEdgeKind;
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function edgesOf(rows: number, cols: number): Edge[] {
  const edges: Edge[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = MARGIN + col * SPACING;
      const y = MARGIN + row * SPACING;
      edges.push({
        edge: 'h',
        index: row * cols + col,
        x1: x,
        y1: y,
        x2: x + SPACING,
        y2: y,
      });
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const x = MARGIN + col * SPACING;
      const y = MARGIN + row * SPACING;
      edges.push({
        edge: 'v',
        index: row * (cols + 1) + col,
        x1: x,
        y1: y,
        x2: x,
        y2: y + SPACING,
      });
    }
  }
  return edges;
}

export function DotsAndBoxesBoard(props: {
  state: DotsAndBoxesState;
  canMove: boolean;
  /** The seat about to move, previewed on hover. */
  turnSeat: number | undefined;
  /** Short owner labels for claimed boxes, by seat. */
  initials: string[];
  onDraw: (move: DotsAndBoxesMove) => void;
}) {
  const width = () => props.state.cols * SPACING + MARGIN * 2;
  const height = () => props.state.rows * SPACING + MARGIN * 2;
  // The board shape only changes between rounds. Keeping the same edges
  // across moves lets <For> keep each line's element, and keyboard focus.
  const rows = createMemo(() => props.state.rows);
  const cols = createMemo(() => props.state.cols);
  const edges = createMemo(() => edgesOf(rows(), cols()));
  const drawnBy = (edge: Edge) =>
    (edge.edge === 'h' ? props.state.horizontal : props.state.vertical)[
      edge.index
    ];
  const isLast = (edge: Edge) =>
    props.state.last?.edge === edge.edge &&
    props.state.last.index === edge.index;

  return (
    <svg
      class="w-full max-w-[28rem] select-none"
      viewBox={`0 0 ${width()} ${height()}`}
      role="grid"
      aria-label="Dots and boxes board"
    >
      <For each={props.state.boxes}>
        {(owner, index) => (
          <Show when={owner !== null}>
            <g>
              <rect
                x={MARGIN + (index() % props.state.cols) * SPACING + 4}
                y={
                  MARGIN + Math.floor(index() / props.state.cols) * SPACING + 4
                }
                width={SPACING - 8}
                height={SPACING - 8}
                rx={8}
                fill={seatTint(owner as number, 22)}
              />
              <text
                x={
                  MARGIN + (index() % props.state.cols) * SPACING + SPACING / 2
                }
                y={
                  MARGIN +
                  Math.floor(index() / props.state.cols) * SPACING +
                  SPACING / 2
                }
                text-anchor="middle"
                dominant-baseline="central"
                font-size="16"
                font-weight="600"
                fill={seatColor(owner as number)}
              >
                {props.initials[owner as number] ?? ''}
              </text>
            </g>
          </Show>
        )}
      </For>
      <For each={edges()}>
        {(edge) => {
          const seat = () => drawnBy(edge);
          const available = () =>
            props.canMove && seat() === null && props.turnSeat !== undefined;
          return (
            <g
              class="group"
              role={available() ? 'button' : undefined}
              tabindex={available() ? 0 : undefined}
              aria-label={
                available()
                  ? `Draw ${edge.edge === 'h' ? 'horizontal' : 'vertical'} line ${edge.index + 1}`
                  : undefined
              }
              onClick={() => {
                if (available())
                  props.onDraw({ edge: edge.edge, index: edge.index });
              }}
              onKeyDown={(event) => {
                if (!available()) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                props.onDraw({ edge: edge.edge, index: edge.index });
              }}
            >
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke-linecap="round"
                stroke-width={seat() === null ? 3 : isLast(edge) ? 7 : 5}
                stroke={
                  seat() === null
                    ? 'var(--color-edge-muted)'
                    : seatColor(seat() as number)
                }
                stroke-dasharray={seat() === null ? '2 6' : undefined}
              />
              <Show when={available()}>
                <line
                  class="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke-linecap="round"
                  stroke-width={5}
                  stroke={seatTint(props.turnSeat as number, 60)}
                />
                {/* A wide transparent band makes thin lines easy to hit. */}
                <rect
                  x={edge.edge === 'h' ? edge.x1 : edge.x1 - HIT_BAND / 2}
                  y={edge.edge === 'h' ? edge.y1 - HIT_BAND / 2 : edge.y1}
                  width={edge.edge === 'h' ? edge.x2 - edge.x1 : HIT_BAND}
                  height={edge.edge === 'h' ? HIT_BAND : edge.y2 - edge.y1}
                  fill="transparent"
                />
              </Show>
            </g>
          );
        }}
      </For>
      <For
        each={Array.from({
          length: (props.state.rows + 1) * (props.state.cols + 1),
        })}
      >
        {(_, index) => (
          <circle
            cx={MARGIN + (index() % (props.state.cols + 1)) * SPACING}
            cy={MARGIN + Math.floor(index() / (props.state.cols + 1)) * SPACING}
            r={4.5}
            fill="var(--color-ink)"
            pointer-events="none"
          />
        )}
      </For>
    </svg>
  );
}
