import {
  type DatabaseSqlFailure,
  engineFailure,
} from '@core/database-sql/driver';
import { loadDatabaseSqlWasm } from '@core/database-sql/wasm-module';
import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import { ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { match, P } from 'ts-pattern';

export type BoardEngine = Awaited<ReturnType<typeof loadDatabaseSqlWasm>>;

type BoardEngineState =
  | { kind: 'loading' }
  | { kind: 'failed'; failure: DatabaseSqlFailure }
  | { kind: 'ready'; engine: BoardEngine };

/** A board's card places as the view's query holds them. */
export type BoardPositionsState =
  | { kind: 'loading' }
  | { kind: 'failed'; retry: () => void }
  | { kind: 'ready'; positions: CardPosition[] };

/** What a board can show: nothing yet, why it cannot, or what it lays out with. */
export type BoardViewState =
  | { kind: 'loading' }
  | { kind: 'failed'; title: string; message: string; retry: () => void }
  | { kind: 'ready'; engine: BoardEngine; positions: CardPosition[] };

/**
 * The SQL engine a board lays out with. It loads in the background rather
 * than as a resource, so waiting for it never suspends the grid around it.
 */
export function createBoardEngine() {
  const [state, setState] = createSignal<BoardEngineState>({
    kind: 'loading',
  });
  let attempt = 0;
  function load() {
    const current = ++attempt;
    setState({ kind: 'loading' });
    void ResultAsync.fromPromise(loadDatabaseSqlWasm(), engineFailure).match(
      (engine) => {
        if (current === attempt) setState({ kind: 'ready', engine });
      },
      (failure) => {
        if (current === attempt) setState({ kind: 'failed', failure });
      }
    );
  }
  load();
  return { state, retry: load };
}

/** The engine and the card places as one state; a failure of either shows first. */
export function boardViewState(
  engine: ReturnType<typeof createBoardEngine>,
  positions: BoardPositionsState
): BoardViewState {
  return match([engine.state(), positions] as const)
    .returnType<BoardViewState>()
    .with([{ kind: 'failed' }, P._], () => ({
      kind: 'failed',
      title: 'This board could not be loaded',
      message: 'Check your connection, then try again.',
      retry: engine.retry,
    }))
    .with([P._, { kind: 'failed' }], ([, failed]) => ({
      kind: 'failed',
      title: 'This board could not be loaded',
      message: 'The order of its cards could not be read.',
      retry: failed.retry,
    }))
    .with(
      [{ kind: 'ready' }, { kind: 'ready' }],
      ([{ engine: loaded }, { positions: places }]) => ({
        kind: 'ready',
        engine: loaded,
        positions: places,
      })
    )
    .with([{ kind: 'loading' }, P._], [P._, { kind: 'loading' }], () => ({
      kind: 'loading',
    }))
    .exhaustive();
}
