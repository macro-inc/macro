import type {
  MakePersistedStateOptions,
  PersistenceStorage,
} from '@app/lib/persistence';
import {
  createEntryPersistenceStorage,
  type EntryPersistenceHandle,
} from '@components/app/split-layout/entry-persistence';
import { z } from 'zod';
import type { InboxViewSnapshot } from './create-inbox-view-state';

export const INBOX_ENTRY_STATE_KEY = 'inbox.view';

const inboxEntryStateSchema = z.object({
  version: z.literal(1),
  tab: z.enum(['signal', 'noise', 'all']),
  focusKey: z.string().optional(),
});

type InboxEntryState = z.infer<typeof inboxEntryStateSchema>;

function selectEntryState(state: InboxViewSnapshot): InboxEntryState {
  const entryState: InboxEntryState = {
    version: 1,
    tab: state.tab === 'reminders' ? 'signal' : state.tab,
  };

  if (state.focusKey !== undefined) {
    entryState.focusKey = state.focusKey;
  }

  return entryState;
}

function createInboxEntryStorage(options: {
  handle: EntryPersistenceHandle;
  restore: boolean;
}): PersistenceStorage<InboxViewSnapshot> {
  return createEntryPersistenceStorage({
    handle: options.handle,
    key: INBOX_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      if (!options.restore) return undefined;

      const parsed = inboxEntryStateSchema.safeParse(stored);
      if (!parsed.success) return undefined;

      const restored = parsed.data;
      return {
        ...current,
        tab: restored.tab,
        focusKey: restored.focusKey,
      };
    },
    select: selectEntryState,
  });
}

export type CreateInboxViewPersistenceOptions = {
  handle: EntryPersistenceHandle;
  restoreEntryState?: boolean;
};

/** Persists Inbox navigation state with the owning split entry. */
export function createInboxViewPersistence(
  options: CreateInboxViewPersistenceOptions
): MakePersistedStateOptions<InboxViewSnapshot> {
  return {
    storages: [
      createInboxEntryStorage({
        handle: options.handle,
        restore: options.restoreEntryState ?? true,
      }),
    ],
  };
}
