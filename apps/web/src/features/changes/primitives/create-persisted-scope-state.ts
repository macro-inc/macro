/**
 * A signal scoped to one host and mirrored into `localStorage`, so a
 * reload keeps the reviewer's place: which diffs they collapsed, the
 * notes they have not sent yet, how the panes were laid out.
 *
 * The value re-loads whenever the scope key changes; a missing key keeps
 * the state in memory only.
 */

import { type Accessor, createMemo, createSignal } from 'solid-js';

export type PersistedScopeStateOptions<T> = {
  /** The host scope the state belongs to; undefined while it is unknown. */
  scopeKey: Accessor<string | undefined>;
  /** Storage key prefix; the scope key is appended. */
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

export function createPersistedScopeState<T>(
  options: PersistedScopeStateOptions<T>
): [get: Accessor<T>, set: (next: T | ((previous: T) => T)) => void] {
  const storage = options.storage ?? defaultStorage();
  const keyFor = (scopeKey: string) => `${options.namespace}:${scopeKey}`;

  const load = (scopeKey: string | undefined): T => {
    if (!scopeKey || !storage) return options.initial();
    try {
      const raw = storage.getItem(keyFor(scopeKey));
      if (raw == null) return options.initial();
      return options.parse(JSON.parse(raw)) ?? options.initial();
    } catch {
      return options.initial();
    }
  };

  const save = (scopeKey: string | undefined, value: T) => {
    if (!scopeKey || !storage) return;
    try {
      storage.setItem(keyFor(scopeKey), JSON.stringify(value));
    } catch {
      // Storage full or unavailable: the in-memory state still works.
    }
  };

  // One signal per scope: switching hosts loads a fresh signal instead of
  // writing one host's state under another's key.
  const scoped = createMemo(() => {
    const scopeKey = options.scopeKey();
    const [value, setValue] = createSignal<T>(load(scopeKey));
    return { scopeKey, value, setValue };
  });

  const get: Accessor<T> = () => scoped().value();
  const set = (next: T | ((previous: T) => T)) => {
    const { scopeKey, value, setValue } = scoped();
    const resolved =
      typeof next === 'function' ? (next as (previous: T) => T)(value()) : next;
    setValue(() => resolved);
    save(scopeKey, resolved);
  };
  return [get, set];
}
