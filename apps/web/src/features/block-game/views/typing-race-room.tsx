import { throttle } from '@solid-primitives/scheduled';
import { Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { GameStatusBadge } from '../components/game-status-badge';
import { PlayerSeats } from '../components/player-seats';
import { PanelSection, RoomLayout } from '../components/room-layout';
import { TypingRaceTrack } from '../components/typing-race-track';
import { type ScoreOutcome, useGamesContext } from '../context/games-context';
import { gameDefinition } from '../core/catalog';
import {
  MAX_TYPING_OVERRUN,
  typingProgress,
  wordsPerMinute,
} from '../core/games/typing-race';
import type { GameRoom } from '../primitives/create-game-room';
import { createStatusPublisher } from '../primitives/create-room-reporting';
import { createTypingRace } from '../primitives/create-typing-race';
import { TeamLeaderboardPanel } from './team-leaderboard-panel';

const PROGRESS_THROTTLE_MS = 250;

/** The passage with what has been typed marked as correct or mistaken. */
function Passage(props: { passage: string; typed: string }) {
  const progress = () => typingProgress(props.passage, props.typed);
  return (
    <p class="w-full select-none rounded-2xl border border-edge-muted bg-panel p-4 font-mono text-base text-ink-subtle leading-relaxed">
      <span class="text-success">
        {props.passage.slice(0, progress().correct)}
      </span>
      <span class="rounded-sm bg-red-bg text-red">
        {props.passage.slice(
          progress().correct,
          progress().correct + progress().overrun
        )}
      </span>
      <span class="border-accent border-b-2 text-ink">
        {props.passage[progress().correct + progress().overrun] ?? ''}
      </span>
      {props.passage.slice(progress().correct + progress().overrun + 1)}
    </p>
  );
}

export function TypingRaceRoom(props: { room: GameRoom; documentId: string }) {
  const games = useGamesContext();
  const definition = gameDefinition('typing_race');
  const race = createTypingRace(props.room);
  const [typed, setTyped] = createSignal('');
  const [mistakes, setMistakes] = createSignal(0);
  const [outcome, setOutcome] = createSignal<ScoreOutcome>();
  let input: HTMLTextAreaElement | undefined;

  createStatusPublisher({
    status: race.status,
    enabled: props.room.canPlay,
    leads: props.room.wroteLatest,
    publish: (status) => games.publishStatus(props.documentId, status),
  });

  const publishProgress = throttle(race.reportProgress, PROGRESS_THROTTLE_MS);

  // Memoized: progress writes and clock ticks re-run the race derivations,
  // but these effects must fire only when their values change.
  const roundNumber = createMemo(() => race.current()?.round);
  const stageKind = createMemo(() => race.stage()?.t);
  const racing = createMemo(() => race.isRacing());

  // A new round clears local typing; racing focuses the input (DOM effect).
  createEffect(
    on(roundNumber, () => {
      setTyped('');
      setMistakes(0);
      setOutcome(undefined);
    })
  );
  createEffect(
    on(stageKind, (stage) => {
      if (stage === 'racing' && racing()) input?.focus();
    })
  );
  createEffect(
    on(racing, (isRacing) =>
      props.room.setPresence({ activity: isRacing ? 'playing' : 'watching' })
    )
  );

  const myProgress = () => {
    const userId = props.room.userId();
    return userId ? race.progress().get(userId) : undefined;
  };
  const finished = () => myProgress()?.finishedMs !== undefined;

  async function finish(elapsedMs: number, characters: number) {
    const wpm = wordsPerMinute(characters, elapsedMs);
    publishProgress.clear();
    race.reportProgress({
      typed: characters,
      mistakes: mistakes(),
      finishedMs: elapsedMs,
      wpm,
    });
    setOutcome(await games.submitScore('typing_race', wpm));
  }

  const onInput = (value: string) => {
    const round = race.current();
    const stage = race.stage();
    if (!round || stage?.t !== 'racing' || finished()) return;
    const progress = typingProgress(round.passage, value);
    // Stop accepting input after a run of mistakes; fix them first.
    if (progress.overrun > MAX_TYPING_OVERRUN) return;
    if (value.length > typed().length && progress.overrun > 0)
      setMistakes((count) => count + 1);
    setTyped(value);
    if (progress.done) {
      // Measured from this client's own countdown end, so clock skew between
      // racers shifts when "Go" appears but never the time a racer typed.
      void finish(Date.now() - round.startsAt, round.passage.length);
      return;
    }
    publishProgress({ typed: progress.correct, mistakes: mistakes() });
  };

  const message = () => {
    const stage = race.stage();
    const round = race.current();
    if (!stage || !round || stage.t === 'finished') {
      if (race.inLobby())
        return 'Start a race when everyone has joined. Latecomers race next time.';
      return 'Join the race to type along.';
    }
    if (stage.t === 'countdown')
      return `Get ready… ${Math.ceil(stage.msLeft / 1000)}`;
    if (!race.isRacing()) return 'Race in progress. You can join the next one.';
    if (finished()) return 'Finished! Waiting for the others.';
    return 'Go! Type the passage exactly.';
  };

  return (
    <RoomLayout
      title={definition.title}
      status={
        <GameStatusBadge
          status={race.status()}
          category={definition.category}
        />
      }
      actions={
        <>
          <Show when={race.canJoin()}>
            <Button variant="accent" size="sm" onClick={race.join}>
              Join race
            </Button>
          </Show>
          <Show when={race.canStart()}>
            <Button variant="accent" size="sm" onClick={race.startRace}>
              {race.current() ? 'Race again' : 'Start race'}
            </Button>
          </Show>
          <Show when={race.canLeave() && !race.isRacing()}>
            <Button size="sm" onClick={race.leave}>
              Leave
            </Button>
          </Show>
        </>
      }
      players={
        <Show when={race.race().lobby.length > 0}>
          <PlayerSeats
            seats={race.race().lobby.map((userId) => ({
              userId,
              name: games.displayName(userId),
            }))}
            turnSeat={undefined}
            viewerId={props.room.userId()}
            winners={[]}
          />
        </Show>
      }
      message={
        <Show
          when={race.stage()?.t === 'finished' && outcome()?.improved}
          fallback={message()}
        >
          New personal best: {outcome()?.best} WPM 🎉
        </Show>
      }
      board={
        <Show
          when={race.current()}
          keyed
          fallback={<p class="text-ink-subtle text-sm">No races yet.</p>}
        >
          {(round) => (
            <div class="flex w-full max-w-2xl flex-col gap-4">
              <TypingRaceTrack
                standings={race.standings()}
                racers={round.racers}
                passageLength={round.passage.length}
                viewerId={props.room.userId()}
                displayName={games.displayName}
              />
              <Passage passage={round.passage} typed={typed()} />
              <Switch>
                <Match when={race.isRacing() && !finished()}>
                  <textarea
                    ref={input}
                    class="h-20 w-full resize-none rounded-2xl border border-edge-muted bg-input p-3 font-mono text-ink outline-none focus:border-accent disabled:opacity-50"
                    aria-label="Type the passage"
                    placeholder={
                      race.stage()?.t === 'countdown'
                        ? 'Get ready…'
                        : 'Start typing…'
                    }
                    disabled={race.stage()?.t !== 'racing'}
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck={false}
                    value={typed()}
                    onInput={(event) => {
                      onInput(event.currentTarget.value);
                      // Keep the field in sync when input is refused.
                      if (event.currentTarget.value !== typed())
                        event.currentTarget.value = typed();
                    }}
                    onPaste={(event) => event.preventDefault()}
                  />
                </Match>
                <Match when={race.stage()?.t === 'finished'}>
                  <ol class="flex flex-col gap-1 rounded-2xl border border-edge-muted bg-panel p-3 text-sm">
                    <For each={race.standings()}>
                      {(row, index) => (
                        <li class="flex items-center gap-2">
                          <span class="w-5 text-right text-ink-subtle tabular-nums">
                            {index() + 1}
                          </span>
                          <span class="flex-1 truncate text-ink">
                            {games.displayName(row.userId)}
                          </span>
                          <span class="text-ink-muted tabular-nums">
                            {row.progress?.wpm !== undefined
                              ? `${row.progress.wpm} WPM`
                              : 'Did not finish'}
                          </span>
                        </li>
                      )}
                    </For>
                  </ol>
                </Match>
              </Switch>
            </div>
          )}
        </Show>
      }
      sidebar={
        <>
          <TeamLeaderboardPanel kind="typing_race" />
          <PanelSection title="How to play">
            <p class="px-2 text-ink-muted text-sm">{definition.howToPlay}</p>
          </PanelSection>
        </>
      }
    />
  );
}
