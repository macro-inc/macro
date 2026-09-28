import { Index } from 'solid-js';
import {
  BRICK_BALL_RADIUS,
  BRICK_FIELD,
  BRICK_PADDLE,
  type BrickBreakerState,
  brickRect,
} from '../core/games/brick-breaker';

/** Rows keep the classic rainbow, top row first. */
const ROW_TOKENS = ['red', 'orange', 'amber', 'green', 'blue', 'violet'];

export function BrickBreakerBoard(props: {
  state: BrickBreakerState;
  ref?: (element: SVGSVGElement) => void;
}) {
  return (
    <svg
      ref={props.ref}
      class="w-full max-w-[34rem] select-none rounded-2xl border border-edge-muted bg-panel"
      viewBox={`0 0 ${BRICK_FIELD.width} ${BRICK_FIELD.height}`}
      role="img"
      aria-label={`Brick Breaker, level ${props.state.level}, ${props.state.score} points, ${props.state.lives} balls left`}
    >
      <Index each={props.state.bricks}>
        {(alive, index) => {
          const rect = brickRect(index);
          return (
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={0.8}
              fill={`var(--color-${ROW_TOKENS[rect.row % ROW_TOKENS.length]})`}
              opacity={alive() ? 1 : 0}
            />
          );
        }}
      </Index>
      <rect
        x={props.state.paddleX - BRICK_PADDLE.width / 2}
        y={BRICK_PADDLE.y}
        width={BRICK_PADDLE.width}
        height={BRICK_PADDLE.height}
        rx={BRICK_PADDLE.height / 2}
        fill="var(--color-ink)"
      />
      <circle
        cx={props.state.ball.x}
        cy={props.state.ball.y}
        r={BRICK_BALL_RADIUS}
        fill="var(--color-accent)"
      />
    </svg>
  );
}
