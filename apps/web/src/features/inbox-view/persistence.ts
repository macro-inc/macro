import {
  type MakePersistedStateOptions,
  makePersistedState,
  type PersistenceStorage,
} from '@app/lib/persistence';
import {
  createEntryPersistenceStorage,
  type EntryPersistenceHandle,
} from '@components/app/split-layout/entry-persistence';
import { createStore } from 'solid-js/store';
import { z } from 'zod';
import type { InboxViewSnapshot } from './create-inbox-view-state';

export const INBOX_ENTRY_STATE_KEY = 'inbox.view';
export const INBOX_LIST_ENTRY_STATE_KEY = 'inbox.listState';

const inboxEntryStateSchema = z.object({
  version: z.literal(1),
  tab: z.enum(['signal', 'noise', 'all']),
});

type InboxEntryState = z.infer<typeof inboxEntryStateSchema>;

const inboxListEntryStateSchema = z.object({
  version: z.literal(1),
  focusKey: z.string().optional(),
  scrollOffset: z.number().finite().optional(),
});

type InboxListEntryState = z.infer<typeof inboxListEntryStateSchema>;

type InboxListStateSnapshot = {
  focusKey: string | undefined;
  scrollOffset: number | undefined;
};

function selectEntryState(state: InboxViewSnapshot): InboxEntryState {
  return {
    version: 1,
    tab: state.tab === 'reminders' ? 'signal' : state.tab,
  };
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
      };
    },
    select: selectEntryState,
  });
}

export type CreateInboxViewPersistenceOptions = {
  handle: EntryPersistenceHandle;
  restoreEntryState?: boolean;
};

function createInboxListEntryStorage(
  handle: EntryPersistenceHandle
): PersistenceStorage<InboxListStateSnapshot> {
  return createEntryPersistenceStorage({
    handle,
    key: INBOX_LIST_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      const parsed = inboxListEntryStateSchema.safeParse(stored);
      if (!parsed.success) return undefined;
      return {
        ...current,
        focusKey: parsed.data.focusKey,
        scrollOffset: parsed.data.scrollOffset,
      };
    },
    select: (state): InboxListEntryState => ({
      version: 1,
      ...(state.focusKey === undefined ? {} : { focusKey: state.focusKey }),
      ...(state.scrollOffset === undefined
        ? {}
        : { scrollOffset: state.scrollOffset }),
    }),
  });
}

export function createInboxListState(handle: EntryPersistenceHandle) {
  const [state, setState] = makePersistedState(
    createStore<InboxListStateSnapshot>({
      focusKey: undefined,
      scrollOffset: undefined,
    }),
    { storages: createInboxListEntryStorage(handle) }
  );

  return {
    focusKey: () => state.focusKey,
    setFocusKey: (focusKey: string | undefined) =>
      setState('focusKey', focusKey),
    scrollOffset: () => state.scrollOffset,
    setScrollOffset: (scrollOffset: number | undefined) =>
      setState('scrollOffset', scrollOffset),
  };
}

export type InboxListState = ReturnType<typeof createInboxListState>;

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
