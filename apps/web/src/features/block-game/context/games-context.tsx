import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type { GameKind } from '../core/catalog';
import type { Leaderboards } from '../core/leaderboard';
import type { GameStatus } from '../core/status';

export type LeaderboardsSource = {
  /** Undefined until the first response; the team's rows once loaded. */
  leaderboards: Accessor<Leaderboards | undefined>;
  isLoading: Accessor<boolean>;
  /** May coexist with loaded leaderboards after a background refresh fails. */
  error: Accessor<Error | undefined>;
};

export type ScoreOutcome = {
  best: number;
  improved: boolean;
};

export type RoundOutcome = {
  documentId: string;
  kind: GameKind;
  round: number;
  winner: string | undefined;
  players: string[];
};

/** Capabilities every game surface uses, supplied by production wiring. */
export type GamesContext = {
  userId: Accessor<string | undefined>;
  displayName: (userId: string) => string;
  createLeaderboards(): LeaderboardsSource;
  /** Record a finished solo run or race; resolves undefined when it fails. */
  submitScore(kind: GameKind, score: number): Promise<ScoreOutcome | undefined>;
  /** Report a finished round; resolves false when it did not get through. */
  reportRound(outcome: RoundOutcome): Promise<boolean>;
  /**
   * Publish a room's state as its document Status for lists and channels.
   * Resolves true once stored, false when the write failed.
   */
  publishStatus(documentId: string, status: GameStatus): Promise<boolean>;
};

const Context = createContext<GamesContext>();

export function GamesProvider(props: {
  value: GamesContext;
  children: JSX.Element;
}) {
  return (
    <Context.Provider value={props.value}>{props.children}</Context.Provider>
  );
}

export function useGamesContext(): GamesContext {
  const context = useContext(Context);
  if (!context) throw new Error('GamesProvider is required');
  return context;
}
