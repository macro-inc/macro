import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { GAME_KINDS, type GameKind, gameDefinition } from '../core/catalog';
import type { GameRoom } from '../primitives/create-game-room';
import {
  BrickBreakerRoom,
  FallingBlocksRoom,
  FlappyRoom,
  InvadersRoom,
} from './arcade-rooms';
import { PongRoom } from './pong-room';
import { MinesweeperRoom, SnakeRoom, TwentyFortyEightRoom } from './solo-rooms';
import { TypingRaceRoom } from './typing-race-room';
import {
  ConnectFourRoom,
  DotsAndBoxesRoom,
  TicTacToeRoom,
} from './versus-rooms';

const ROOM_VIEWS: Record<
  GameKind,
  (props: {
    room: GameRoom;
    documentId: string;
  }) => ReturnType<typeof SnakeRoom>
> = {
  pong: PongRoom,
  brick_breaker: BrickBreakerRoom,
  snake: SnakeRoom,
  falling_blocks: FallingBlocksRoom,
  invaders: InvadersRoom,
  flappy: FlappyRoom,
  twenty_forty_eight: TwentyFortyEightRoom,
  minesweeper: MinesweeperRoom,
  tic_tac_toe: TicTacToeRoom,
  connect_four: ConnectFourRoom,
  dots_and_boxes: DotsAndBoxesRoom,
  typing_race: TypingRaceRoom,
};

function CenteredNote(props: { children: string }) {
  return (
    <div class="flex size-full items-center justify-center p-6 text-center text-ink-muted text-sm">
      {props.children}
    </div>
  );
}

/** Rooms opened before their game was recorded let an editor choose it. */
function KindPicker(props: {
  canChoose: boolean;
  onChoose: (kind: GameKind) => void;
}) {
  return (
    <div class="flex size-full flex-col items-center justify-center gap-4 p-6">
      <p class="text-ink-muted text-sm">
        {props.canChoose
          ? 'Pick a game for this room.'
          : 'This room has no game yet. Ask an editor to pick one.'}
      </p>
      <Show when={props.canChoose}>
        <div class="flex max-w-lg flex-wrap justify-center gap-2">
          <For each={GAME_KINDS}>
            {(kind) => (
              <Button onClick={() => props.onChoose(kind)}>
                {gameDefinition(kind).title}
              </Button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** One room: its game once known, with loading and failure states around it. */
export function GameRoomView(props: { room: GameRoom; documentId: string }) {
  return (
    <Switch>
      <Match when={!props.room.ready() && props.room.error()}>
        {(error) => <CenteredNote>{error()}</CenteredNote>}
      </Match>
      <Match when={!props.room.ready()}>
        <CenteredNote>Loading game…</CenteredNote>
      </Match>
      <Match when={props.room.kind()} keyed>
        {(kind) => (
          <Dynamic
            component={ROOM_VIEWS[kind]}
            room={props.room}
            documentId={props.documentId}
          />
        )}
      </Match>
      <Match when={props.room.ready()}>
        <KindPicker
          canChoose={props.room.canPlay()}
          onChoose={props.room.chooseKind}
        />
      </Match>
    </Switch>
  );
}
