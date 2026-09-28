import { Show } from 'solid-js';
import {
  PONG_BALL_RADIUS,
  PONG_COURT,
  PONG_PADDLE,
  type PongBall,
  type PongSeat,
} from '../core/games/pong';
import { seatColor } from './seat-color';

export function PongCourt(props: {
  ball: PongBall | undefined;
  paddles: readonly [number, number];
  scores: readonly [number, number];
  /** The paddle this viewer moves, outlined so it is easy to find. */
  controlledSeat: PongSeat | undefined;
  ref?: (element: SVGSVGElement) => void;
}) {
  const paddleX = (seat: PongSeat) =>
    seat === 0
      ? PONG_PADDLE.inset - PONG_PADDLE.width
      : PONG_COURT.width - PONG_PADDLE.inset;

  const paddle = (seat: PongSeat) => (
    <rect
      x={paddleX(seat)}
      y={props.paddles[seat] - PONG_PADDLE.height / 2}
      width={PONG_PADDLE.width}
      height={PONG_PADDLE.height}
      rx={PONG_PADDLE.width / 2}
      fill={seatColor(seat)}
      stroke={props.controlledSeat === seat ? 'var(--color-ink)' : 'none'}
      stroke-width={0.4}
    />
  );

  return (
    <svg
      ref={props.ref}
      class="w-full max-w-[40rem] select-none rounded-2xl border border-edge-muted bg-panel"
      viewBox={`0 0 ${PONG_COURT.width} ${PONG_COURT.height}`}
      role="img"
      aria-label={`Pong court, ${props.scores[0]} to ${props.scores[1]}`}
    >
      <line
        x1={PONG_COURT.width / 2}
        y1={0}
        x2={PONG_COURT.width / 2}
        y2={PONG_COURT.height}
        stroke="var(--color-edge-muted)"
        stroke-width={0.5}
        stroke-dasharray="2 2"
      />
      <text
        x={PONG_COURT.width / 2 - 8}
        y={11}
        text-anchor="end"
        font-size="8"
        font-weight="600"
        fill={seatColor(0)}
        class="tabular-nums"
      >
        {props.scores[0]}
      </text>
      <text
        x={PONG_COURT.width / 2 + 8}
        y={11}
        text-anchor="start"
        font-size="8"
        font-weight="600"
        fill={seatColor(1)}
        class="tabular-nums"
      >
        {props.scores[1]}
      </text>
      {paddle(0)}
      {paddle(1)}
      <Show when={props.ball}>
        {(ball) => (
          <rect
            x={ball().x - PONG_BALL_RADIUS}
            y={ball().y - PONG_BALL_RADIUS}
            width={PONG_BALL_RADIUS * 2}
            height={PONG_BALL_RADIUS * 2}
            rx={0.3}
            fill="var(--color-ink)"
          />
        )}
      </Show>
    </svg>
  );
}
