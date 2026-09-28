import { UserIcon } from '@core/component/UserIcon';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  Show,
} from 'solid-js';
import { GameStatusBadge } from '../components/game-status-badge';
import { LeaderboardList } from '../components/leaderboard-list';
import { PanelSection, RoomLayout } from '../components/room-layout';
import { type ScoreOutcome, useGamesContext } from '../context/games-context';
import {
  formatScore,
  type GameKind,
  gameDefinition,
  type ScoreUnit,
} from '../core/catalog';
import type { GameRoom } from '../primitives/create-game-room';
import { createStatusPublisher } from '../primitives/create-room-reporting';
import { createSoloRoom } from '../primitives/create-solo-room';
import type { RunPhase } from '../primitives/create-solo-runs';
import { TeamLeaderboardPanel } from './team-leaderboard-panel';

function unitOf(kind: GameKind): ScoreUnit {
  const scoring = gameDefinition(kind).scoring;
  return scoring.t === 'high-score' ? scoring.unit : 'points';
}

/** Record a finished run in the room and on the team leaderboard. */
export function createFinisher(room: GameRoom, kind: GameKind) {
  const games = useGamesContext();
  const solo = createSoloRoom(room, kind);
  const [outcome, setOutcome] = createSignal<ScoreOutcome>();

  async function finish(score: number) {
    setOutcome(undefined);
    solo.recordRun(score);
    // A run that never scored stays in the room without claiming a record.
    if (score > 0) setOutcome(await games.submitScore(kind, score));
  }

  return { solo, outcome, finish: (score: number) => void finish(score) };
}

/** Everything solo rooms share around their board. */
export function SoloRoomShell(props: {
  room: GameRoom;
  documentId: string;
  kind: GameKind;
  solo: ReturnType<typeof createSoloRoom>;
  phase: Accessor<RunPhase>;
  score: Accessor<number>;
  outcome: ScoreOutcome | undefined;
  message: JSX.Element;
  actions: JSX.Element;
  board: JSX.Element;
}) {
  const games = useGamesContext();
  const definition = gameDefinition(props.kind);
  const unit = unitOf(props.kind);
  const playing = () => props.phase() === 'playing';

  createStatusPublisher({
    status: () => props.solo.status(playing()),
    enabled: props.room.canPlay,
    // Spectators derive "playing now" from presence; the player publishes it.
    leads: () => playing() || props.room.wroteLatest(),
    publish: (status) => games.publishStatus(props.documentId, status),
  });
  // Presence is an external system: share whether we play, and how it goes.
  // Memoized so it is sent when the score changes, not on every game tick;
  // a running clock is shared to the second.
  const liveScore = createMemo(() => {
    if (!playing()) return undefined;
    const score = props.score();
    return unit === 'milliseconds' ? Math.floor(score / 1000) * 1000 : score;
  });
  createEffect(
    on(liveScore, (score) =>
      props.room.setPresence(
        score === undefined
          ? { activity: 'watching' }
          : { activity: 'playing', score }
      )
    )
  );

  const roomBests = () =>
    props.solo.bests().map((run, index) => ({
      userId: run.userId,
      rank: index + 1,
      value: run.score,
      at: run.at,
    }));

  return (
    <RoomLayout
      title={definition.title}
      status={
        <GameStatusBadge
          status={props.solo.status(playing())}
          category={definition.category}
        />
      }
      actions={props.actions}
      message={
        <Show
          when={props.phase() === 'over' && props.outcome?.improved}
          fallback={props.message}
        >
          New personal best: {formatScore(unit, props.outcome?.best ?? 0)} 🎉
        </Show>
      }
      board={props.board}
      sidebar={
        <>
          <Show when={props.solo.playingPeers().length > 0}>
            <PanelSection title="Playing now">
              <ul class="flex flex-col gap-1 px-2 text-sm">
                <For each={props.solo.playingPeers()}>
                  {(peer) => (
                    <li class="flex items-center gap-2">
                      <Show when={peer.userId}>
                        {(userId) => (
                          <UserIcon id={userId()} size="md" suppressClick />
                        )}
                      </Show>
                      <span class="min-w-0 flex-1 truncate text-ink">
                        {peer.userId ? games.displayName(peer.userId) : 'Guest'}
                      </span>
                      <Show when={peer.presence.score !== undefined}>
                        <span class="text-ink-muted tabular-nums">
                          {formatScore(unit, peer.presence.score ?? 0)}
                        </span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </PanelSection>
          </Show>
          <PanelSection title="This room">
            <LeaderboardList
              rows={roomBests()}
              viewer={undefined}
              viewerId={games.userId()}
              displayName={games.displayName}
              formatValue={(value) => formatScore(unit, value)}
              empty={
                <p class="px-2 text-ink-subtle text-sm">
                  Finished runs show up here.
                </p>
              }
            />
          </PanelSection>
          <TeamLeaderboardPanel kind={props.kind} />
          <PanelSection title="How to play">
            <p class="px-2 text-ink-muted text-sm">{definition.howToPlay}</p>
          </PanelSection>
        </>
      }
    />
  );
}
