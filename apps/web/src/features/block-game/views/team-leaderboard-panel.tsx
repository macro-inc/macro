import { Show } from 'solid-js';
import { LeaderboardList } from '../components/leaderboard-list';
import { PanelSection } from '../components/room-layout';
import { useGamesContext } from '../context/games-context';
import { formatScore, type GameKind, gameDefinition } from '../core/catalog';

/** The team's ranking for one game, or the viewer's own best without a team. */
export function TeamLeaderboardPanel(props: { kind: GameKind }) {
  const games = useGamesContext();
  const source = games.createLeaderboards();
  const definition = () => gameDefinition(props.kind);
  const board = () => source.leaderboards()?.games[props.kind];
  const hasTeam = () => source.leaderboards()?.teamId !== undefined;
  const title = () => {
    const wins = definition().scoring.t === 'wins';
    if (!hasTeam()) return wins ? 'Your wins' : 'Your best';
    return wins ? 'Team wins' : 'Team high scores';
  };
  const formatValue = (value: number) => {
    const scoring = definition().scoring;
    if (scoring.t === 'wins') return value === 1 ? '1 win' : `${value} wins`;
    return formatScore(scoring.unit, value);
  };

  return (
    <PanelSection title={title()}>
      <Show
        when={!source.isLoading() || source.leaderboards()}
        fallback={<p class="px-2 text-ink-subtle text-sm">Loading…</p>}
      >
        <Show
          when={!source.error() || source.leaderboards()}
          fallback={
            <p class="px-2 text-ink-subtle text-sm">
              Leaderboard unavailable right now.
            </p>
          }
        >
          <LeaderboardList
            rows={board()?.rows ?? []}
            viewer={board()?.viewer}
            viewerId={games.userId()}
            displayName={games.displayName}
            formatValue={formatValue}
            empty={
              <p class="px-2 text-ink-subtle text-sm">
                No results yet. Set the first record!
              </p>
            }
          />
        </Show>
      </Show>
    </PanelSection>
  );
}
