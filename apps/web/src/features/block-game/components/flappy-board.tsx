import { Index } from 'solid-js';
import {
  FLAPPY_BIRD,
  FLAPPY_FIELD,
  FLAPPY_GAP,
  FLAPPY_GROUND,
  FLAPPY_PIPE_WIDTH,
  type FlappyState,
} from '../core/games/flappy';

const CAP = { height: 4, overhang: 1.5 };

export function FlappyBoard(props: { state: FlappyState }) {
  // Tilt with speed: nose up on a flap, down in a dive.
  const tilt = () => Math.max(-25, Math.min(70, props.state.velocity * 0.35));

  return (
    <svg
      class="w-full max-w-[20rem] select-none overflow-hidden rounded-2xl border border-edge-muted bg-panel"
      viewBox={`0 0 ${FLAPPY_FIELD.width} ${FLAPPY_FIELD.height}`}
      role="img"
      aria-label={`Flappy, ${props.state.score} points`}
    >
      {/* Pipes move every frame; Index keeps their nodes in place. */}
      <Index each={props.state.pipes}>
        {(pipe) => {
          const top = () => pipe().gapY - FLAPPY_GAP / 2;
          const bottom = () => pipe().gapY + FLAPPY_GAP / 2;
          return (
            <g fill="var(--color-green)">
              <rect
                x={pipe().x}
                y={0}
                width={FLAPPY_PIPE_WIDTH}
                height={top()}
              />
              <rect
                x={pipe().x - CAP.overhang}
                y={top() - CAP.height}
                width={FLAPPY_PIPE_WIDTH + CAP.overhang * 2}
                height={CAP.height}
                rx={0.8}
              />
              <rect
                x={pipe().x}
                y={bottom()}
                width={FLAPPY_PIPE_WIDTH}
                height={FLAPPY_GROUND - bottom()}
              />
              <rect
                x={pipe().x - CAP.overhang}
                y={bottom()}
                width={FLAPPY_PIPE_WIDTH + CAP.overhang * 2}
                height={CAP.height}
                rx={0.8}
              />
            </g>
          );
        }}
      </Index>
      <rect
        x={0}
        y={FLAPPY_GROUND}
        width={FLAPPY_FIELD.width}
        height={FLAPPY_FIELD.height - FLAPPY_GROUND}
        fill="var(--color-amber)"
        opacity={0.5}
      />
      <g
        transform={`translate(${FLAPPY_BIRD.x} ${props.state.birdY}) rotate(${tilt()})`}
      >
        <circle r={FLAPPY_BIRD.radius} fill="var(--color-amber)" />
        <circle cx={1.3} cy={-1.2} r={0.9} fill="var(--color-panel)" />
        <circle cx={1.6} cy={-1.2} r={0.4} fill="var(--color-ink)" />
        <path d="M2.8 0.2 L5 0.9 L2.8 1.7 Z" fill="var(--color-orange)" />
      </g>
    </svg>
  );
}
