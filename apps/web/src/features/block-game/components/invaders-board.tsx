import { Index, Show } from 'solid-js';
import {
  INVADER_SIZE,
  INVADERS_FIELD,
  INVADERS_PLAYER,
  type InvadersState,
  invaderPosition,
} from '../core/games/invaders';

/** The classic 11×8 invader, one path segment per lit pixel. */
const INVADER_PIXELS = [
  '..X.....X..',
  '...X...X...',
  '..XXXXXXX..',
  '.XX.XXX.XX.',
  'XXXXXXXXXXX',
  'X.XXXXXXX.X',
  'X.X.....X.X',
  '...XX.XX...',
];
const INVADER_PATH = INVADER_PIXELS.flatMap((line, row) =>
  [...line].flatMap((pixel, col) =>
    pixel === 'X' ? [`M${col} ${row}h1v1h-1z`] : []
  )
).join('');
const PIXEL_SCALE = {
  x: INVADER_SIZE.width / INVADER_PIXELS[0].length,
  y: INVADER_SIZE.height / INVADER_PIXELS.length,
};

/** Rows share a color, top row first. */
const ROW_TOKENS = ['violet', 'blue', 'blue', 'green', 'green'];

export function InvadersBoard(props: {
  state: InvadersState;
  ref?: (element: SVGSVGElement) => void;
}) {
  const blinking = () =>
    props.state.recovering > 0 &&
    Math.floor(props.state.recovering / 150) % 2 === 0;

  return (
    <svg
      ref={props.ref}
      class="w-full max-w-[34rem] select-none rounded-2xl border border-edge-muted bg-panel"
      viewBox={`0 0 ${INVADERS_FIELD.width} ${INVADERS_FIELD.height}`}
      role="img"
      aria-label={`Invaders, wave ${props.state.wave}, ${props.state.score} points, ${props.state.lives} lives`}
    >
      <Index each={props.state.invaders}>
        {(alive, index) => {
          const position = () => invaderPosition(props.state, index);
          return (
            <path
              d={INVADER_PATH}
              transform={`translate(${position().x} ${position().y}) scale(${PIXEL_SCALE.x} ${PIXEL_SCALE.y})`}
              fill={`var(--color-${ROW_TOKENS[position().row % ROW_TOKENS.length]})`}
              opacity={alive() ? 1 : 0}
            />
          );
        }}
      </Index>
      <Show when={props.state.shot}>
        {(shot) => (
          <rect
            x={shot().x - 0.3}
            y={shot().y - 1.6}
            width={0.6}
            height={2.4}
            fill="var(--color-accent)"
          />
        )}
      </Show>
      <Index each={props.state.bombs}>
        {(bomb) => (
          <rect
            x={bomb().x - 0.4}
            y={bomb().y - 1.2}
            width={0.8}
            height={2}
            rx={0.3}
            fill="var(--color-red)"
          />
        )}
      </Index>
      <g
        transform={`translate(${props.state.playerX - INVADERS_PLAYER.width / 2} ${INVADERS_PLAYER.y})`}
        opacity={blinking() ? 0.3 : 1}
      >
        <rect
          y={1}
          width={INVADERS_PLAYER.width}
          height={INVADERS_PLAYER.height - 1}
          rx={0.6}
          fill="var(--color-ink)"
        />
        <rect
          x={INVADERS_PLAYER.width / 2 - 0.7}
          width={1.4}
          height={1.4}
          fill="var(--color-ink)"
        />
      </g>
      <line
        x1={0}
        y1={INVADERS_PLAYER.y + INVADERS_PLAYER.height + 1}
        x2={INVADERS_FIELD.width}
        y2={INVADERS_PLAYER.y + INVADERS_PLAYER.height + 1}
        stroke="var(--color-edge-muted)"
        stroke-width={0.4}
      />
    </svg>
  );
}
