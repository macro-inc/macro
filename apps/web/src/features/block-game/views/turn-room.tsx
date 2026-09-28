import { Button } from '@ui';
import { createEffect, createMemo, For, type JSX, on, Show } from 'solid-js';
import { GameStatusBadge } from '../components/game-status-badge';
import { PlayerSeats } from '../components/player-seats';
import { PanelSection, RoomLayout } from '../components/room-layout';
import { useGamesContext } from '../context/games-context';
import { type GameKind, gameDefinition } from '../core/catalog';
import type { TurnRules } from '../core/turn-match';
import type { GameRoom } from '../primitives/create-game-room';
import {
  createRoundLedger,
  createRoundReporter,
  createStatusPublisher,
} from '../primitives/create-room-reporting';
import {
  createTurnMatch,
  type TurnMatchState,
} from '../primitives/create-turn-match';
import { TeamLeaderboardPanel } from './team-leaderboard-panel';

/**
 * Shared composition for turn-based rooms: seats, turn messages, actions,
 * result reporting and the status published to lists and channels.
 */
export function TurnRoom<State, Move>(props: {
  room: GameRoom;
  documentId: string;
  kind: GameKind;
  rules: TurnRules<State, Move>;
  board: (match: TurnMatchState<State, Move>) => JSX.Element;
  /** Seat marker, such as X and O; defaults to the seat number. */
  marker?: (seat: number) => JSX.Element;
  /** Live per-seat detail, such as boxes claimed. */
  detail?: (state: State, seat: number) => string | undefined;
  /** Replaces the turn message while a round is played, for real-time games. */
  playingMessage?: (state: State) => string;
  /** Highlight the seat to move; off for games without turns. */
  showTurn?: boolean;
}) {
  const games = useGamesContext();
  const definition = gameDefinition(props.kind);
  const match = createTurnMatch(props.room, props.rules);
  const name = (userId: string) => games.displayName(userId);

  createStatusPublisher({
    status: match.status,
    enabled: props.room.canPlay,
    leads: props.room.wroteLatest,
    publish: (status) => games.publishStatus(props.documentId, status),
  });
  createRoundReporter({
    results: () => match.match().results,
    seatedRound: () => {
      const current = match.phase();
      return current.t === 'playing' && match.mySeat() >= 0
        ? current.round
        : undefined;
    },
    userId: props.room.userId,
    enabled: props.room.canPlay,
    ledger: createRoundLedger(
      () => `macro.games.rounds.${props.documentId}.${props.room.userId()}`
    ),
    report: (result) =>
      games.reportRound({
        documentId: props.documentId,
        kind: props.kind,
        round: result.round,
        winner: result.winners.length === 1 ? result.winners[0] : undefined,
        players: result.players,
      }),
  });
  // Presence is an external system: tell others whether we play or watch.
  // Memoized so it is sent when seating changes, not on every move.
  const seated = createMemo(() => match.mySeat() >= 0);
  createEffect(
    on(seated, (isSeated) =>
      props.room.setPresence({ activity: isSeated ? 'playing' : 'watching' })
    )
  );

  const phase = match.phase;
  const seats = () =>
    match.match().seats.map((userId, seat) => {
      const current = phase();
      const live =
        current.t === 'playing' || current.t === 'over'
          ? props.detail?.(current.state, seat)
          : undefined;
      const wins = match.wins().get(userId) ?? 0;
      return {
        userId,
        name: name(userId),
        marker: props.marker?.(seat),
        detail: live ?? (wins > 0 ? `${wins} won` : undefined),
      };
    });

  const turnSeat = () => {
    const current = phase();
    return current.t === 'playing' && props.showTurn !== false
      ? current.turn
      : undefined;
  };
  const winners = () => {
    const current = phase();
    return current.t === 'over' ? current.result.winners : [];
  };

  const message = () => {
    const current = phase();
    if (current.t === 'lobby') {
      const seated = match.match().seats.length;
      if (seated < props.rules.seats.min)
        return seated === 0
          ? 'Take a seat to start a game.'
          : 'Waiting for an opponent. Share this game so someone can join.';
      return props.rules.autoStart
        ? 'Table is full.'
        : 'Ready when you are. Anyone seated can start.';
    }
    if (current.t === 'playing') {
      if (props.playingMessage) return props.playingMessage(current.state);
      if (match.isMyTurn()) return 'Your turn';
      return `${name(match.match().seats[current.turn])}'s turn`;
    }
    const { winners, forfeitedBy } = current.result;
    const prefix = forfeitedBy ? `${name(forfeitedBy)} forfeited. ` : '';
    if (winners.length === 0) return `${prefix}It's a draw.`;
    if (winners.length > 1)
      return `${prefix}Tie between ${winners.map(name).join(' and ')}.`;
    return winners[0] === props.room.userId()
      ? `${prefix}You win! 🎉`
      : `${prefix}${name(winners[0])} wins!`;
  };

  return (
    <RoomLayout
      title={definition.title}
      status={
        <GameStatusBadge
          status={match.status()}
          category={definition.category}
        />
      }
      actions={
        <>
          <Show when={match.canJoin()}>
            <Button variant="accent" size="sm" onClick={match.join}>
              Join game
            </Button>
          </Show>
          {/* Full two-seat tables start themselves, except after a reopen. */}
          <Show
            when={
              match.canStart() &&
              (!props.rules.autoStart ||
                match.match().seats.length === props.rules.seats.max)
            }
          >
            <Button variant="accent" size="sm" onClick={match.start}>
              Start
            </Button>
          </Show>
          <Show when={match.canLeave()}>
            <Button size="sm" onClick={match.leave}>
              Leave seat
            </Button>
          </Show>
          <Show when={match.canRematch()}>
            <Button variant="accent" size="sm" onClick={match.rematch}>
              Rematch
            </Button>
            <Button size="sm" onClick={match.reopen}>
              Change players
            </Button>
          </Show>
          <Show when={match.canForfeit()}>
            <Button variant="danger" size="sm" onClick={match.forfeit}>
              Forfeit
            </Button>
          </Show>
        </>
      }
      players={
        <Show when={seats().length > 0}>
          <PlayerSeats
            seats={seats()}
            turnSeat={turnSeat()}
            viewerId={props.room.userId()}
            winners={winners()}
          />
        </Show>
      }
      message={message()}
      board={props.board(match)}
      footer={
        <Show when={!props.room.canPlay()}>
          <p class="text-ink-subtle text-sm">
            You're watching. Ask the owner for edit access to play.
          </p>
        </Show>
      }
      sidebar={
        <>
          <Show when={match.match().results.length > 0}>
            <PanelSection title="This room">
              <ul class="flex flex-col gap-1 px-2 text-sm">
                <For each={match.match().seats}>
                  {(userId) => (
                    <li class="flex items-center justify-between gap-2">
                      <span class="truncate text-ink">{name(userId)}</span>
                      <span class="font-medium text-ink tabular-nums">
                        {match.wins().get(userId) ?? 0}
                      </span>
                    </li>
                  )}
                </For>
                <li class="text-ink-subtle text-xs">
                  {match.match().results.length === 1
                    ? '1 round played'
                    : `${match.match().results.length} rounds played`}
                </li>
              </ul>
            </PanelSection>
          </Show>
          <TeamLeaderboardPanel kind={props.kind} />
          <PanelSection title="How to play">
            <p class="px-2 text-ink-muted text-sm">{definition.howToPlay}</p>
          </PanelSection>
        </>
      }
    />
  );
}
