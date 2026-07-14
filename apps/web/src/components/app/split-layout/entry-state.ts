import {
  type Accessor,
  createSignal,
  onCleanup,
  type Setter,
  untrack,
} from 'solid-js';
import type { EntryState, NavigationCause } from './layoutManager';
import { useSplitPanelOrThrow } from './layoutUtils';

export type UseEntryStateOptions<T> = {
  /**
   * Value used when this entry has no captured state for `key` yet
   * (e.g. on first visit, or after a fresh navigation that cleared state).
   */
  default: T;
};

/**
 * Component-owned per-history-entry state.
 *
 * Returns a signal whose initial value is read from the current split entry's
 * `state[key]` slot (if present) or from `options.default`. The signal value
 * is captured back into the entry just before any navigation away (back,
 * forward, replace, push), so it round-trips correctly across back/forward.
 *
 * Slice keys are flat and shared across the split's entry state blob — use a
 * dotted namespace convention (e.g. `'search.text'`, `'soup.scroll'`).
 *
 * Must be called from inside a component rendered under a `<SplitPanel>`.
 */
export function useEntryState<T>(
  key: string,
  options: UseEntryStateOptions<T>
): [Accessor<T>, Setter<T>] {
  const panel = useSplitPanelOrThrow();
  const handle = panel.handle;

  const persisted = untrack(() => {
    const blob = (handle.content() as { state?: EntryState }).state;
    return blob && key in blob ? (blob[key] as T) : undefined;
  });
  const initial = persisted !== undefined ? persisted : options.default;

  const [value, setValue] = createSignal<T>(initial);

  const teardown = handle.registerEntryStateCaptor(key, () => value());
  onCleanup(teardown);

  return [value, setValue];
}

/**
 * Reactive accessor for the cause of the most recent navigation into this
 * split. `'fresh'` on initial mount and on explicit replace-with-new-entry;
 * `'history-back'` / `'history-forward'` when the user used back/forward;
 * `'replace'` when an existing entry was merged in place.
 *
 * Useful for behaviors that should differ between fresh navigation and
 * restoration (e.g. don't auto-focus the search bar on history navigation).
 */
export function useNavigationCause(): Accessor<NavigationCause> {
  const panel = useSplitPanelOrThrow();
  return () => panel.handle.lastNavigationCause();
}
