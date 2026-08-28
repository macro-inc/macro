import { type Accessor, onCleanup, type Setter, untrack } from 'solid-js';
import { reconcile, type SetStoreFunction, type Store } from 'solid-js/store';

type AccessorState<TValue> = [get: Accessor<TValue>, set: Setter<TValue>];

type StoreState<TValue extends object> = [
  get: Store<TValue>,
  set: SetStoreFunction<TValue>,
];

type PersistableState = AccessorState<any> | StoreState<any>;

type PersistedStateValue<TState extends PersistableState> =
  TState[0] extends Accessor<infer TValue>
    ? TValue
    : TState[0] extends Store<infer TValue>
      ? TValue
      : never;

export type PersistedState<TState extends PersistableState> = [
  get: TState[0],
  set: TState[1],
  restored: PersistedStateValue<TState> | undefined,
];

/**
 * One persistence projection over a canonical state value.
 *
 * `restore` merges this storage's owned fields onto the state restored so
 * far. `write` receives the final canonical state and selects what to retain.
 */
export type PersistenceStorage<T> = {
  restore: (current: T) => T | undefined;
  write: (value: T) => unknown;
  initialize?: (value: T) => void;
  dispose?: () => void;
};

export type MakePersistedStateOptions<T> = {
  /**
   * Storages restore in array order, so later storages have higher
   * precedence. Writes are offered to every storage.
   */
  storages: PersistenceStorage<T> | PersistenceStorage<T>[];
};

/**
 * Setter-driven persistence for Solid signals, stores, and custom
 * accessor/setter pairs.
 *
 * Restoration is synchronous and ordered. All state mutations must use the
 * returned setter to reach storages.
 */
export function makePersistedState<TValue>(
  state: AccessorState<TValue>,
  options: MakePersistedStateOptions<TValue>
): PersistedState<AccessorState<TValue>>;
export function makePersistedState<TValue extends object>(
  state: StoreState<TValue>,
  options: MakePersistedStateOptions<TValue>
): PersistedState<StoreState<TValue>>;
export function makePersistedState<TState extends PersistableState>(
  state: TState,
  options: MakePersistedStateOptions<PersistedStateValue<TState>>
): PersistedState<TState> {
  type TValue = PersistedStateValue<TState>;

  const storages = (
    Array.isArray(options.storages) ? options.storages : [options.storages]
  ) as PersistenceStorage<TValue>[];

  const isAccessorState = typeof state[0] === 'function';
  const get = (isAccessorState ? state[0] : () => state[0]) as Accessor<TValue>;
  const set = state[1] as (...args: any[]) => any;

  let restored = untrack(get);
  let didRestore = false;

  for (const storage of storages) {
    try {
      const next = storage.restore(restored);
      if (next === undefined) continue;
      restored = next;
      didRestore = true;
    } catch {
      // One unavailable storage must not prevent remaining restores.
    }
  }

  if (didRestore) {
    if (isAccessorState) {
      // Wrapping avoids treating function-valued state as a setter callback.
      set(() => restored);
    } else {
      set(reconcile(restored));
    }
  }

  const current = untrack(get);
  for (const storage of storages) {
    try {
      storage.initialize?.(current);
    } catch {
      // Initialization is best effort, matching restores and writes.
    }
    if (storage.dispose) onCleanup(storage.dispose);
  }

  const persistCurrent = () => {
    const value = untrack(get);
    for (const storage of storages) {
      try {
        storage.write(value);
      } catch {
        // In-memory state remains canonical when a storage is unavailable.
      }
    }
  };

  const persistedSetter = isAccessorState
    ? (...args: any[]) => {
        const result = set(...args);
        persistCurrent();
        return result;
      }
    : (...args: any[]) => {
        set(...args);
        persistCurrent();
      };

  return [
    state[0],
    persistedSetter as TState[1],
    didRestore ? restored : undefined,
  ];
}
