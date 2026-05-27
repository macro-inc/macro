import { makePersisted } from '@solid-primitives/storage';
import { type Accessor, createSignal, type Setter } from 'solid-js';

export type UsePreferenceOptions<T> = {
  /** Value used when no saved preference exists yet. */
  default: T;
};

/**
 * Cross-session user preference, persisted to localStorage by `key`.
 *
 * Use for sticky, view-kind-scoped settings the user has chosen once and
 * expects to apply on every visit (e.g. how a view is sorted or grouped).
 * For state that should travel with a specific history entry instead, use
 * `useEntryState`.
 */
export function usePreference<T>(
  key: string,
  options: UsePreferenceOptions<T>
): [Accessor<T>, Setter<T>] {
  const [signal, setSignal] = makePersisted(createSignal<T>(options.default), {
    name: key,
  });
  return [signal, setSignal];
}
