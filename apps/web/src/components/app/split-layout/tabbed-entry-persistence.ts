import type { PersistenceStorage } from '@app/lib/persistence';
import {
  type CreateEntryPersistenceStorageOptions,
  createEntryPersistenceStorage,
} from './entry-persistence';

/**
 * Keeps tab snapshots inside the view's existing entry-state slice. The same
 * captor carries them through history and view resume; disposing the storage
 * releases the snapshots along with the view, without a separate session cache.
 */
export function createTabbedEntryPersistenceStorage<
  TState,
  TStored extends object,
  TTab extends string,
>(
  options: CreateEntryPersistenceStorageOptions<TState, TStored> & {
    tabs: readonly TTab[];
    tab: (state: TState) => TTab | undefined;
    restoreEntryState?: boolean;
  }
): PersistenceStorage<TState> & {
  restoreTab: (current: TState, tab: TTab) => TState | undefined;
  clearTabs: () => void;
} {
  const snapshots = new Map<TTab, TStored>();
  let latest: TStored | undefined;
  const capture = (state: TState) => {
    const selected = options.select(state);
    const tab = options.tab(state);
    if (tab !== undefined) {
      snapshots.set(tab, selected);
      latest = selected;
    }
    // A temporary surface (for example a saved-view draft) must not replace
    // the last built-in snapshot, including the active entry's projection.
    return { ...(latest ?? selected), tabs: Object.fromEntries(snapshots) };
  };
  const storage = createEntryPersistenceStorage({
    ...options,
    select: capture,
    restore: (current, stored) => {
      if (options.restoreEntryState === false) return;
      const restored = options.restore(current, stored);
      if (!restored) return;
      latest = options.select(restored);

      const tabs =
        stored && typeof stored === 'object' && 'tabs' in stored
          ? stored.tabs
          : undefined;
      if (tabs && typeof tabs === 'object') {
        for (const tab of options.tabs) {
          if (!Object.hasOwn(tabs, tab)) continue;
          const snapshot = options.restore(current, Reflect.get(tabs, tab));
          if (snapshot) snapshots.set(tab, options.select(snapshot));
        }
      }
      return restored;
    },
  });

  return {
    ...storage,
    dispose: () => {
      storage.dispose?.();
      snapshots.clear();
      latest = undefined;
    },
    restoreTab: (current, tab) => {
      const snapshot = snapshots.get(tab);
      return snapshot === undefined
        ? undefined
        : options.restore(current, snapshot);
    },
    clearTabs: () => {
      snapshots.clear();
      latest = undefined;
    },
  };
}
