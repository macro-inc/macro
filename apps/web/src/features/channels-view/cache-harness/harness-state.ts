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
  /** REST calls the mocked service clients answered, in order, by method
   * (`channelSections.list`): counted with the network's operations. */
  rest: string[];
  /** The open graph's mutation queue runners, so a step can restart their
   * wall-clock poll before it starts (`run-scale.tsx`). */
  mutationQueues: Array<{ wake(): void }>;
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

/** The object under a Solid store proxy, or `row` itself. A proxy answers
 * `$RAW` before it tracks anything, so reading it creates no store node; the
 * probe then reads the target, never the proxy. */
function rawOf(row: unknown): unknown {
  if (typeof row !== 'object' || row === null) return row;
  return Reflect.get(row, $RAW) ?? row;
}

/** Counts one call of `name` over `rows` and returns `run`'s result. */
export function countMapper<T>(
  name: string,
  rows: readonly unknown[],
  run: () => T
): T {
  const trackedWalk =
    getListener() !== null && rows.some((row) => rawOf(row) !== row);
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

/** The `id` a mapper's input row carries, if any, read from the row's
 * target so the count adds no store node of its own. */
function rowId(row: unknown): string | undefined {
  const raw = rawOf(row);
  if (typeof raw !== 'object' || raw === null || !('id' in raw))
    return undefined;
  return typeof raw.id === 'string' ? raw.id : undefined;
}
