import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { ArcadeFrame, fieldPoint } from '../components/arcade-frame';
import { PongCourt } from '../components/pong-court';
import {
  PONG_COURT,
  PONG_POINTS_TO_WIN,
  type PongPoint,
  type PongScore,
  pongRules,
} from '../core/games/pong';
import type { GameRoom } from '../primitives/create-game-room';
import { createPong } from '../primitives/create-pong';
import type { TurnMatchState } from '../primitives/create-turn-match';
import { TurnRoom } from './turn-room';

const PADDLE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'w', 's', 'W', 'S']);

function PongBoard(props: {
  room: GameRoom;
  match: TurnMatchState<PongScore, PongPoint>;
}) {
  const pong = createPong(props.room, props.match);
  let frame: HTMLDivElement | undefined;
  let court: SVGSVGElement | undefined;
  const playing = () => props.match.phase().t === 'playing';
  const scores = (): readonly [number, number] => {
    const phase = props.match.phase();
    if (phase.t !== 'lobby') return phase.state.scores;
    return pong.practice()?.scores ?? [0, 0];
  };
  const practice = () => {
    pong.startPractice();
    frame?.focus();
  };
  const follow = (event: PointerEvent) => {
    if (!court || pong.controlledSeat() === undefined) return;
    pong.pointer(fieldPoint(event, court, PONG_COURT).y);
  };

  return (
    <div class="flex w-full flex-col items-center gap-3">
      <ArcadeFrame
        ref={(element) => {
          frame = element;
        }}
        label="Pong court. Move your paddle with the mouse or the up and down arrow keys."
        onKeyDown={(event) => {
          if (!PADDLE_KEYS.has(event.key)) return false;
          pong.keyDown(event.key);
          return true;
        }}
        onKeyUp={(event) => pong.keyUp(event.key)}
        onBlur={pong.blur}
        onPointerMove={follow}
        onPointerDown={follow}
      >
        <PongCourt
          ref={(element) => {
            court = element;
          }}
          ball={pong.court().ball}
          paddles={pong.court().paddles}
          scores={scores()}
          controlledSeat={pong.controlledSeat()}
        />
      </ArcadeFrame>
      <Show when={!playing() && props.match.phase().t === 'lobby'}>
        <Switch>
          <Match when={pong.practice()?.winner !== undefined}>
            <div class="flex flex-wrap items-center justify-center gap-2 text-ink text-sm">
              <span>
                {pong.practice()?.winner === 0
                  ? 'You beat the computer!'
                  : 'The computer took this one.'}
              </span>
              <Button size="sm" variant="accent" onClick={practice}>
                Practice again
              </Button>
              <Button size="sm" onClick={pong.stopPractice}>
                Done
              </Button>
            </div>
          </Match>
          <Match when={pong.practice()}>
            <Button size="sm" onClick={pong.stopPractice}>
              Stop practice
            </Button>
          </Match>
          <Match when={pong.canPractice()}>
            <Button size="sm" onClick={practice}>
              Practice vs computer
            </Button>
          </Match>
        </Switch>
      </Show>
    </div>
  );
}

export function PongRoom(props: { room: GameRoom; documentId: string }) {
  return (
    <TurnRoom
      room={props.room}
      documentId={props.documentId}
      kind="pong"
      rules={pongRules}
      showTurn={false}
      detail={(state, seat) => {
        const score = state.scores[seat] ?? 0;
        return score === 1 ? '1 point' : `${score} points`;
      }}
      playingMessage={() => `First to ${PONG_POINTS_TO_WIN} wins.`}
      board={(match) => <PongBoard room={props.room} match={match} />}
    />
  );
}
