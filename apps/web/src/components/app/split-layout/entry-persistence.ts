import type { PersistenceStorage } from '@app/lib/persistence';
import type { SplitHandle } from './layoutManager';

export type EntryPersistenceHandle = Pick<
  SplitHandle,
  'currentEntryState' | 'registerEntryStateCaptor'
>;

export type CreateEntryPersistenceStorageOptions<TState, TStored> = {
  handle: EntryPersistenceHandle;
  key: string;
  restore: (current: TState, stored: unknown) => TState | undefined;
  select: (state: TState) => TStored;
};

/**
 * Adapts a split history entry to persistence storage.
 *
 * TODO: Replace the split layout's captor pattern with direct entry-state
 * persistence.
 *
 * The split manager reads the latest canonical value and commits its selected
 * projection to the current history entry immediately before navigation.
 */
export function createEntryPersistenceStorage<TState, TStored>(
  options: CreateEntryPersistenceStorageOptions<TState, TStored>
): PersistenceStorage<TState> {
  let captured: TStored | undefined;
  let readCurrent: (() => TState) | undefined;
  const dispose = options.handle.registerEntryStateCaptor(options.key, () =>
    readCurrent ? options.select(readCurrent()) : captured
  );
  const update = (state: TState) => {
    captured = options.select(state);
  };

  return {
    restore: (current) => {
      const stored = options.handle.currentEntryState()?.[options.key];
      return stored === undefined
        ? undefined
        : options.restore(current, stored);
    },
    initialize: (state, read) => {
      update(state);
      readCurrent = read;
    },
    write: update,
    dispose,
  };
}
