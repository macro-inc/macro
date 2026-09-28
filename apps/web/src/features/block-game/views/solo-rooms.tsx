import { Button } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { MinesweeperBoard } from '../components/minesweeper-board';
import { SnakeBoard } from '../components/snake-board';
import { TwentyFortyEightBoard } from '../components/twenty-forty-eight-board';
import { flagsRemaining } from '../core/games/minesweeper';
import { highestTile } from '../core/games/twenty-forty-eight';
import type { GameRoom } from '../primitives/create-game-room';
import {
  createMinesweeperRun,
  createSnakeRun,
  createTwentyFortyEightRun,
} from '../primitives/create-solo-runs';
import { createSwipe, directionFromKey } from '../primitives/direction-input';
import { createFinisher, SoloRoomShell } from './solo-room-shell';

type RoomProps = { room: GameRoom; documentId: string };

/** A focusable board frame that routes arrow keys, WASD and swipes. */
function DirectionalFrame(props: {
  label: string;
  onDirection: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onKey?: (event: KeyboardEvent) => boolean;
  ref?: (element: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  const swipe = createSwipe(props.onDirection);
  return (
    <div
      ref={props.ref}
      class="flex w-full touch-none justify-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
      tabindex={0}
      role="application"
      aria-label={props.label}
      onKeyDown={(event) => {
        if (props.onKey?.(event)) {
          event.preventDefault();
          return;
        }
        const direction = directionFromKey(event);
        if (!direction) return;
        event.preventDefault();
        props.onDirection(direction);
      }}
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
    >
      {props.children}
    </div>
  );
}

export function SnakeRoom(props: RoomProps) {
  const { solo, outcome, finish } = createFinisher(props.room, 'snake');
  const run = createSnakeRun({ onFinish: finish });
  let frame: HTMLDivElement | undefined;
  const start = () => {
    run.start();
    frame?.focus();
  };

  return (
    <SoloRoomShell
      room={props.room}
      documentId={props.documentId}
      kind="snake"
      solo={solo}
      phase={run.phase}
      score={run.score}
      outcome={outcome()}
      message={
        <Show
          when={run.phase() !== 'ready'}
          fallback="Press an arrow key or swipe to start."
        >
          {run.phase() === 'paused' ? 'Paused. ' : ''}
          {run.phase() === 'over' ? 'Game over. ' : ''}
          {run.score()} points · {run.state().apples} apples
        </Show>
      }
      actions={
        <>
          <Show when={run.phase() === 'playing' || run.phase() === 'paused'}>
            <Button size="sm" onClick={run.togglePause}>
              {run.phase() === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          </Show>
          <Button variant="accent" size="sm" onClick={start}>
            {run.phase() === 'ready' ? 'Start' : 'New game'}
          </Button>
        </>
      }
      board={
        <DirectionalFrame
          ref={(element) => {
            frame = element;
          }}
          label="Snake. Use the arrow keys to steer; space pauses."
          onDirection={run.turn}
          onKey={(event) => {
            if (event.key !== ' ') return false;
            if (run.phase() === 'over') start();
            else run.togglePause();
            return true;
          }}
        >
          <SnakeBoard state={run.state()} />
        </DirectionalFrame>
      }
    />
  );
}

export function TwentyFortyEightRoom(props: RoomProps) {
  const { solo, outcome, finish } = createFinisher(
    props.room,
    'twenty_forty_eight'
  );
  const run = createTwentyFortyEightRun({ onFinish: finish });

  return (
    <SoloRoomShell
      room={props.room}
      documentId={props.documentId}
      kind="twenty_forty_eight"
      solo={solo}
      phase={run.phase}
      score={run.score}
      outcome={outcome()}
      message={
        <>
          {run.phase() === 'over' ? 'No moves left. ' : ''}
          {run.state().won && run.phase() !== 'over'
            ? 'You made 2048! Keep going. '
            : ''}
          {run.score().toLocaleString('en-US')} points · best tile{' '}
          {highestTile(run.state())}
        </>
      }
      actions={
        <Button variant="accent" size="sm" onClick={run.reset}>
          New game
        </Button>
      }
      board={
        <DirectionalFrame
          label="2048. Use the arrow keys or swipe to slide the tiles."
          onDirection={run.slide}
        >
          <TwentyFortyEightBoard state={run.state()} />
        </DirectionalFrame>
      }
    />
  );
}

export function MinesweeperRoom(props: RoomProps) {
  const { solo, outcome, finish } = createFinisher(props.room, 'minesweeper');
  const run = createMinesweeperRun({ onFinish: finish });
  const [flagMode, setFlagMode] = createSignal(false);
  const seconds = () => (run.elapsed() / 1000).toFixed(1);

  return (
    <SoloRoomShell
      room={props.room}
      documentId={props.documentId}
      kind="minesweeper"
      solo={solo}
      phase={run.phase}
      score={run.score}
      outcome={outcome()}
      message={
        <>
          {run.state().status === 'won' ? `Cleared in ${seconds()}s! ` : ''}
          {run.state().status === 'lost' ? 'Boom. ' : ''}
          {run.state().status === 'ready'
            ? 'Click any cell to start. '
            : `⏱ ${seconds()}s · `}
          🚩 {flagsRemaining(run.state())} left
        </>
      }
      actions={
        <>
          <Button
            size="sm"
            aria-pressed={flagMode()}
            onClick={() => setFlagMode((value) => !value)}
          >
            🚩 Flag mode
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => {
              run.reset();
              setFlagMode(false);
            }}
          >
            New game
          </Button>
        </>
      }
      board={
        <MinesweeperBoard
          state={run.state()}
          flagMode={flagMode()}
          disabled={false}
          onReveal={run.reveal}
          onFlag={run.flag}
          onChord={run.chord}
        />
      }
    />
  );
}
