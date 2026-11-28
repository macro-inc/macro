/**
 * What the harness's module mocks read at call time: the client and host the
 * current module graph built, the fixture, and the counters the mocks keep.
 * It lives on `globalThis` because the harness runs each phase in a fresh
 * module graph (`vi.resetModules`), and the mocks of every graph must see
 * the same state.
 */
import type { CacheHost } from '@graphql-cache/host/types';
import type { Client } from '@urql/core';
import { getListener } from 'solid-js';
import { $RAW } from 'solid-js/store';
import type { ChatFixture } from './fixture';

export type ChatHarnessState = {
  fixture: ChatFixture;
  /** The cached client the app's `getGraphqlSoupClient` returns. */
  client?: Client;
  /** The fetch-only client (`getGraphqlSoupNetworkClient`). */
  networkClient?: Client;
  host?: CacheHost;
  /** Each counted mapper's work, by name. */
  mappers: Record<string, MapperCounter>;
  /** Feature flags the code under test read, by key, with the answer. */
  flags: Record<string, boolean>;
  /** Calls that would have left the process; a faithful run has none. */
  escapes: string[];
};

/** One mapper's work. `calls` counts every call; `built` only calls whose
 * result was not returned before, so a memoized answer is not work;
 * `trackedWalks` the calls made inside a tracking scope over a store proxy,
 * which create a store node for every field the mapper reads (FE-70); `ids`
 * holds the rows mapped since `clearMappedRows`. */
export type MapperCounter = {
  calls: number;
  built: number;
  trackedWalks: number;
  ids: Set<string>;
};

const STATE_KEY = Symbol.for('macro.chat-cache-harness');

type WithState = { [STATE_KEY]?: ChatHarnessState };

export function setHarnessState(state: ChatHarnessState): void {
  (globalThis as WithState)[STATE_KEY] = state;
}

export function harnessState(): ChatHarnessState {
  const state = (globalThis as WithState)[STATE_KEY];
  if (!state) throw new Error('The chat cache harness has not started');
  return state;
}

// Results every mapper has returned, to tell a memoized answer from new work.
const RETURNED = new WeakSet<object>();

/** A Solid store proxy answers `$RAW` with its target; plain data has none. */
function isStoreProxy(row: unknown): boolean {
  return (
    typeof row === 'object' &&
    row !== null &&
    Reflect.get(row, $RAW) !== undefined
  );
}

/** Counts one call of `name` over `rows` and returns `run`'s result. */
export function countMapper<T>(
  name: string,
  rows: readonly unknown[],
  run: () => T
): T {
  const trackedWalk = getListener() !== null && rows.some(isStoreProxy);
  const result = run();
  const state = (globalThis as WithState)[STATE_KEY];
  if (!state) return result;
  const counter = state.mappers[name] ?? {
    calls: 0,
    built: 0,
    trackedWalks: 0,
    ids: new Set<string>(),
  };
  state.mappers[name] = counter;
  counter.calls += 1;
  const fresh =
    typeof result !== 'object' || result === null || !RETURNED.has(result);
  if (fresh) counter.built += 1;
  if (trackedWalk) counter.trackedWalks += 1;
  if (typeof result === 'object' && result !== null) RETURNED.add(result);
  for (const row of rows) {
    const id = rowId(row);
    if (id !== undefined) counter.ids.add(id);
  }
  return result;
}

/** Starts a step's count of distinct rows mapped. */
export function clearMappedRows(): void {
  for (const counter of Object.values(harnessState().mappers))
    counter.ids.clear();
}

/** The `id` a mapper's input row carries, if any. */
export function rowId(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null || !('id' in row))
    return undefined;
  return typeof row.id === 'string' ? row.id : undefined;
}
