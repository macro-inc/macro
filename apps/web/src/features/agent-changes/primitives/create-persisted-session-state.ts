/**
 * A signal scoped to one session and mirrored into `localStorage`, so a
 * reload keeps the reviewer's place: which diffs they collapsed, the
 * notes they have not sent yet, how the panes were laid out.
 *
 * The value re-loads whenever the session id changes; a missing id keeps
 * the state in memory only.
 */

import { type Accessor, createMemo, createSignal } from 'solid-js';

export type PersistedSessionStateOptions<T> = {
  /** The session the state belongs to; undefined while it is unknown. */
  sessionId: Accessor<string | undefined>;
  /** Storage key prefix; the session id is appended. */
  namespace: string;
  initial: () => T;
  /** Turn a stored JSON value back into state, or reject it with undefined. */
  parse: (raw: unknown) => T | undefined;
  /** Defaults to `window.localStorage`; tests pass their own. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
};

function defaultStorage():
  | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function createPersistedSessionState<T>(
  options: PersistedSessionStateOptions<T>
): [get: Accessor<T>, set: (next: T | ((previous: T) => T)) => void] {
  const storage = options.storage ?? defaultStorage();
  const keyFor = (sessionId: string) => `${options.namespace}:${sessionId}`;

  const load = (sessionId: string | undefined): T => {
    if (!sessionId || !storage) return options.initial();
    try {
      const raw = storage.getItem(keyFor(sessionId));
      if (raw == null) return options.initial();
      return options.parse(JSON.parse(raw)) ?? options.initial();
    } catch {
      return options.initial();
    }
  };

  const save = (sessionId: string | undefined, value: T) => {
    if (!sessionId || !storage) return;
    try {
      storage.setItem(keyFor(sessionId), JSON.stringify(value));
    } catch {
      // Storage full or unavailable: the in-memory state still works.
    }
  };

  // One signal per session id: switching sessions swaps to a freshly loaded
  // signal instead of writing one session's state under another's key.
  const scoped = createMemo(() => {
    const sessionId = options.sessionId();
    const [value, setValue] = createSignal<T>(load(sessionId));
    return { sessionId, value, setValue };
  });

  const get: Accessor<T> = () => scoped().value();
  const set = (next: T | ((previous: T) => T)) => {
    const { sessionId, value, setValue } = scoped();
    const resolved =
      typeof next === 'function' ? (next as (previous: T) => T)(value()) : next;
    setValue(() => resolved);
    save(sessionId, resolved);
  };
  return [get, set];
}
