import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { ArcadeFrame, fieldPoint } from '../components/arcade-frame';
import { BrickBreakerBoard } from '../components/brick-breaker-board';
import { FallingBlocksBoard } from '../components/falling-blocks-board';
import { FlappyBoard } from '../components/flappy-board';
import { InvadersBoard } from '../components/invaders-board';
import { BRICK_FIELD } from '../core/games/brick-breaker';
import { INVADERS_FIELD } from '../core/games/invaders';
import {
  createBrickBreakerRun,
  createFallingBlocksRun,
  createFlappyRun,
  createInvadersRun,
} from '../primitives/create-arcade-runs';
import type { GameRoom } from '../primitives/create-game-room';
import type { RunPhase } from '../primitives/create-solo-runs';
import { createSwipe } from '../primitives/direction-input';
import { createFinisher, SoloRoomShell } from './solo-room-shell';

type RoomProps = { room: GameRoom; documentId: string };

const STEER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D']);

/** Pause and new-game controls shared by the arcade rooms. */
function RunActions(props: {
  phase: RunPhase;
  onTogglePause: () => void;
  onStart: () => void;
}) {
  return (
    <>
      <Show when={props.phase === 'playing' || props.phase === 'paused'}>
        {/* Keep focus on the board, whose blur would pause the game again. */}
        <Button
          size="sm"
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
          onClick={props.onTogglePause}
        >
          {props.phase === 'paused' ? 'Resume' : 'Pause'}
        </Button>
      </Show>
      <Button variant="accent" size="sm" onClick={props.onStart}>
        {props.phase === 'ready' ? 'Start' : 'New game'}
      </Button>
    </>
  );
}

function prefix(phase: RunPhase): string {
  if (phase === 'paused') return 'Paused. ';
  if (phase === 'over') return 'Game over. ';
  return '';
}

function points(score: number): string {
  return score === 1 ? '1 point' : `${score.toLocaleString('en-US')} points`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function BrickBreakerRoom(props: RoomProps) {
  const { solo, outcome, finish } = createFinisher(props.room, 'brick_breaker');
  const run = createBrickBreakerRun({ onFinish: finish });
  let frame: HTMLDivElement | undefined;
  let board: SVGSVGElement | undefined;
  const start = () => {
    if (run.phase() !== 'ready') run.reset();
    run.launch();
    frame?.focus();
  };
  const resumeOrLaunch = () => {
    if (run.phase() === 'paused') run.togglePause();
    else if (run.phase() !== 'over') run.launch();
  };
  const message = (): JSX.Element => {
    const state = run.state();
    if (run.phase() === 'ready') return 'Click or press Space to launch.';
    const waiting =
      run.phase() === 'playing' && !state.launched
        ? ' · Click or press Space to launch'
        : '';
    return `${prefix(run.phase())}${points(state.score)} · Level ${state.level} · ${plural(state.lives, 'ball', 'balls')} left${waiting}`;
  };

  return (
    <SoloRoomShell
      room={props.room}
      documentId={props.documentId}
      kind="brick_breaker"
      solo={solo}
      phase={run.phase}
      score={run.score}
      outcome={outcome()}
      message={message()}
      actions={
        <RunActions
          phase={run.phase()}
          onTogglePause={run.togglePause}
          onStart={start}
        />
      }
      board={
        <ArcadeFrame
          ref={(element) => {
            frame = element;
          }}
          label="Brick Breaker. Move the paddle with the mouse or arrow keys; Space launches the ball."
          onKeyDown={(event) => {
            if (event.key === 'Enter' && run.phase() === 'over') {
              start();
              return true;
            }
            if (event.key === ' ') {
              resumeOrLaunch();
              return true;
            }
            if (!STEER_KEYS.has(event.key)) return false;
            run.keyDown(event.key);
            return true;
          }}
          onKeyUp={(event) => run.keyUp(event.key)}
          onBlur={() => {
            run.blur();
            run.pause();
          }}
          onPointerMove={(event) => {
            if (board) run.pointer(fieldPoint(event, board, BRICK_FIELD).x);
          }}
          onPointerDown={(event) => {
            if (board) run.pointer(fieldPoint(event, board, BRICK_FIELD).x);
            resumeOrLaunch();
          }}
        >
          <BrickBreakerBoard
            ref={(element) => {
              board = element;
            }}
            state={run.state()}
          />
        </ArcadeFrame>
      }
    />
  );
}

export function FallingBlocksRoom(props: RoomProps) {
  const { solo, outcome, finish } = createFinisher(
    props.room,
    'falling_blocks'
  );
  const run = createFallingBlocksRun({ onFinish: finish });
  let frame: HTMLDivElement | undefined;
  const start = () => {
    run.start();
    frame?.focus();
  };
  const swipe = createSwipe((direction) => {
    if (direction === 'left') run.left();
    else if (direction === 'right') run.right();
    else if (direction === 'down') run.hardDrop();
    else run.rotate();
  }, run.rotate);
  const message = (): JSX.Element => {
    const state = run.state();
    if (run.phase() === 'ready') return 'Press an arrow key or Space to start.';
    return `${prefix(run.phase())}${points(state.score)} · ${plural(state.lines, 'line', 'lines')}`;
  };

  return (
    <SoloRoomShell
      room={props.room}
      documentId={props.documentId}
      kind="falling_blocks"
      solo={solo}
      phase={run.phase}
      score={run.score}
      outcome={outcome()}
      message={message()}
      actions={
        <RunActions
          phase={run.phase()}
          onTogglePause={run.togglePause}
          onStart={start}
        />
      }
      board={
        <ArcadeFrame
          ref={(element) => {
            frame = element;
          }}
          label="Falling Blocks. Left and right move, Up rotates, Down drops faster, Space drops instantly."
          onKeyDown={(event) => {
            const key =
              event.key.length === 1 ? event.key.toLowerCase() : event.key;
            if (run.phase() === 'paused') {
              if (key === ' ' || key === 'p') run.togglePause();
              return key === ' ';
            }
            switch (key) {
              case 'ArrowLeft':
              case 'a':
                run.left();
                return true;
              case 'ArrowRight':
              case 'd':
                run.right();
                return true;
              case 'ArrowUp':
              case 'w':
              case 'x':
                run.rotate();
                return true;
              case 'z':
                run.rotateBack();
                return true;
              case 'ArrowDown':
              case 's':
                run.softDrop();
                return true;
              case ' ':
                run.hardDrop();
                return true;
              case 'Enter':
                if (run.phase() !== 'over') return false;
                start();
                return true;
              case 'p':
                run.togglePause();
                return true;
              default:
                return false;
            }
          }}
          onBlur={run.pause}
          onPointerDown={swipe.onPointerDown}
          onPointerUp={swipe.onPointerUp}
          onPointerCancel={swipe.onPointerCancel}
        >
          <FallingBlocksBoard state={run.state()} />
        </ArcadeFrame>
      }
    />
  );
}

export function InvadersRoom(props: RoomProps) {
  const { solo, outcome, finish } = createFinisher(props.room, 'invaders');
  const run = createInvadersRun({ onFinish: finish });
  let frame: HTMLDivElement | undefined;
  let board: SVGSVGElement | undefined;
  const start = () => {
    run.start();
    frame?.focus();
  };
  const message = (): JSX.Element => {
    const state = run.state();
    if (run.phase() === 'ready') return 'Press Space or click to start.';
    return `${prefix(run.phase())}${points(state.score)} · Wave ${state.wave} · ${plural(state.lives, 'life', 'lives')}`;
  };

  return (
    <SoloRoomShell
      room={props.room}
      documentId={props.documentId}
      kind="invaders"
      solo={solo}
      phase={run.phase}
      score={run.score}
      outcome={outcome()}
      message={message()}
      actions={
        <RunActions
          phase={run.phase()}
          onTogglePause={run.togglePause}
          onStart={start}
        />
      }
      board={
        <ArcadeFrame
          ref={(element) => {
            frame = element;
          }}
          label="Invaders. Move with the arrow keys or mouse; Space or a click fires."
          onKeyDown={(event) => {
            if (event.key === 'Enter' && run.phase() === 'over') {
              start();
              return true;
            }
            if (event.key === ' ') {
              if (run.phase() === 'paused') run.togglePause();
              else run.keyDown(' ');
              return true;
            }
            if (!STEER_KEYS.has(event.key)) return false;
            run.keyDown(event.key);
            return true;
          }}
          onKeyUp={(event) => run.keyUp(event.key)}
          onBlur={() => {
            run.blur();
            run.pause();
          }}
          onPointerMove={(event) => {
            if (board) run.pointer(fieldPoint(event, board, INVADERS_FIELD).x);
          }}
          onPointerDown={(event) => {
            if (board) run.pointer(fieldPoint(event, board, INVADERS_FIELD).x);
            if (run.phase() === 'paused') run.togglePause();
            else run.fire();
          }}
        >
          <InvadersBoard
            ref={(element) => {
              board = element;
            }}
            state={run.state()}
          />
        </ArcadeFrame>
      }
    />
  );
}

export function FlappyRoom(props: RoomProps) {
  const { solo, outcome, finish } = createFinisher(props.room, 'flappy');
  const run = createFlappyRun({ onFinish: finish });
  let frame: HTMLDivElement | undefined;
  const start = () => {
    if (run.phase() !== 'ready') run.reset();
    run.flap();
    frame?.focus();
  };
  // A crash ignores flaps, so frantic tapping does not skip the result.
  const flapOrResume = () => {
    if (run.phase() === 'paused') run.togglePause();
    else run.flap();
  };
  const message = (): JSX.Element => {
    if (run.phase() === 'ready') return 'Click, tap, or press Space to flap.';
    return `${prefix(run.phase())}${points(run.state().score)}`;
  };

  return (
    <SoloRoomShell
      room={props.room}
      documentId={props.documentId}
      kind="flappy"
      solo={solo}
      phase={run.phase}
      score={run.score}
      outcome={outcome()}
      message={message()}
      actions={
        <RunActions
          phase={run.phase()}
          onTogglePause={run.togglePause}
          onStart={start}
        />
      }
      board={
        <ArcadeFrame
          ref={(element) => {
            frame = element;
          }}
          label="Flappy. Click, tap, or press Space to flap."
          onKeyDown={(event) => {
            if (event.key === 'Enter' && run.phase() === 'over') {
              start();
              return true;
            }
            if (event.key !== ' ' && event.key !== 'ArrowUp') return false;
            flapOrResume();
            return true;
          }}
          onBlur={run.pause}
          onPointerDown={flapOrResume}
        >
          <FlappyBoard state={run.state()} />
        </ArcadeFrame>
      }
    />
  );
}
