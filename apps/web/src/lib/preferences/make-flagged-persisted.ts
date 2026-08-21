import { makePersisted, type SyncStorage } from '@solid-primitives/storage';
import { type Accessor, createEffect, on, type Signal } from 'solid-js';

type FlaggedPersistenceOptions<T> = {
  /** Whether persistence should currently be active. */
  enabled: Accessor<boolean>;
  /** The localStorage key. */
  name: string;
  /** Optional value serializer. Defaults to JSON.stringify. */
  serialize?: (value: T) => string;
  /** Optional value deserializer. Defaults to JSON.parse. */
  deserialize?: (value: string) => T;
};

/**
 * Wraps a signal with localStorage persistence controlled by a reactive flag.
 *
 * When the flag resolves from disabled to enabled, the signal hydrates once
 * from storage. If the signal was changed while persistence was disabled, its
 * live value wins instead of being overwritten by stale storage.
 */
export function makeFlaggedPersisted<T>(
  signal: Signal<T>,
  options: FlaggedPersistenceOptions<T>
): Signal<T> {
  const localStorage = globalThis.localStorage;
  const serialize =
    options.serialize ?? ((value: T) => JSON.stringify(value) as string);
  const disabledBaseline = serialize(signal[0]());
  let changedWhileDisabled = false;
  let hydrated = options.enabled();

  const storage: SyncStorage = {
    getItem: (key) =>
      options.enabled() ? (localStorage?.getItem(key) ?? null) : null,
    setItem: (key, value) => {
      if (!options.enabled()) {
        if (value !== disabledBaseline) changedWhileDisabled = true;
        return;
      }
      localStorage?.setItem(key, value);
    },
    removeItem: (key) => {
      if (!options.enabled()) {
        if (disabledBaseline !== undefined) changedWhileDisabled = true;
        return;
      }
      localStorage?.removeItem(key);
    },
  };

  const [value, setValue] = makePersisted(signal, {
    name: options.name,
    storage,
    serialize: options.serialize,
    deserialize: options.deserialize,
  });

  createEffect(
    on(options.enabled, (enabled) => {
      if (!enabled || hydrated) return;
      hydrated = true;

      if (changedWhileDisabled) return;

      const serialized = localStorage?.getItem(options.name);
      if (serialized === null || serialized === undefined) return;

      try {
        const restored = options.deserialize
          ? options.deserialize(serialized)
          : (JSON.parse(serialized) as T);
        signal[1](() => restored);
      } catch {
        return;
      }
    })
  );

  return [value, setValue];
}
