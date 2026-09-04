import type {
  MakePersistedStateOptions,
  PersistenceStorage,
} from '@app/lib/persistence';
import {
  createEntryPersistenceStorage,
  type EntryPersistenceHandle,
} from '@components/app/split-layout/entry-persistence';
import { z } from 'zod';
import type { InboxViewState } from './types';

export const INBOX_ENTRY_STATE_KEY = 'inbox.view';
export const INBOX_LIST_ENTRY_STATE_KEY = 'inbox.listState';

const inboxEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: z.enum(['signal', 'noise', 'all']).default('signal'),
});

type InboxEntryState = z.infer<typeof inboxEntryStateSchemaWithDefaults>;

const DEFAULT_INBOX_ENTRY_STATE = {
  version: 1,
  tab: 'signal',
} satisfies InboxEntryState;

const inboxListEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  focusKey: z.string().optional(),
  scrollOffset: z.number().finite().default(0),
});

type InboxListEntryState = z.infer<
  typeof inboxListEntryStateSchemaWithDefaults
>;

const DEFAULT_INBOX_LIST_ENTRY_STATE = {
  version: 1,
  focusKey: undefined,
  scrollOffset: 0,
} satisfies InboxListEntryState;

export type InboxListStateSnapshot = {
  focusKey: InboxListEntryState['focusKey'];
  scrollOffset: InboxListEntryState['scrollOffset'];
};

export const DEFAULT_INBOX_LIST_STATE: InboxListStateSnapshot = {
  focusKey: undefined,
  scrollOffset: 0,
};

function selectEntryState(state: InboxViewState): InboxEntryState {
  return {
    version: 1,
    tab: state.tab === 'reminders' ? 'signal' : state.tab,
  };
}

function createInboxEntryStorage(options: {
  handle: EntryPersistenceHandle;
  restore: boolean;
}): PersistenceStorage<InboxViewState> {
  return createEntryPersistenceStorage({
    handle: options.handle,
    key: INBOX_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      if (!options.restore) return undefined;

      const result = inboxEntryStateSchemaWithDefaults.safeParse(stored);
      const restored = result.success ? result.data : DEFAULT_INBOX_ENTRY_STATE;

      return {
        ...current,
        tab: restored.tab,
      };
    },
    select: selectEntryState,
  });
}

export type CreateInboxViewPersistenceOptions = {
  handle: EntryPersistenceHandle;
  restoreEntryState?: boolean;
};

export function createInboxListEntryStorage(
  handle: EntryPersistenceHandle
): PersistenceStorage<InboxListStateSnapshot> {
  return createEntryPersistenceStorage({
    handle,
    key: INBOX_LIST_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      const result = inboxListEntryStateSchemaWithDefaults.safeParse(stored);
      const restored = result.success
        ? result.data
        : DEFAULT_INBOX_LIST_ENTRY_STATE;

      return {
        ...current,
        focusKey: restored.focusKey,
        scrollOffset: restored.scrollOffset,
      };
    },
    select: (state): InboxListEntryState => ({
      version: 1,
      ...(state.focusKey === undefined ? {} : { focusKey: state.focusKey }),
      scrollOffset: state.scrollOffset,
    }),
  });
}

/** Persists Inbox navigation state with the owning split entry. */
export function createInboxViewPersistence(
  options: CreateInboxViewPersistenceOptions
): MakePersistedStateOptions<InboxViewState> {
  return {
    storages: [
      createInboxEntryStorage({
        handle: options.handle,
        restore: options.restoreEntryState ?? true,
      }),
    ],
  };
}
