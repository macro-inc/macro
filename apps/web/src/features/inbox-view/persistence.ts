import { normalizeFacetSelection } from '@app/features/soup/filters/facets/selection';
import type {
  MakePersistedStateOptions,
  PersistenceStorage,
} from '@app/lib/persistence';
import {
  createEntryPersistenceStorage,
  type EntryPersistenceHandle,
} from '@components/app/split-layout/entry-persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import type { Accessor } from 'solid-js';
import { z } from 'zod';
import type { InboxViewState } from './types';

export const INBOX_ENTRY_STATE_KEY = 'inbox.view';
export const INBOX_LIST_ENTRY_STATE_KEY = 'inbox.listState';
const homeFilterStorage = createUserScopedStorage('macro:home:filters:v1');

/** Status is a single choice; an empty selection means All. */
export function normalizeInboxFacets(raw: unknown) {
  const facets = normalizeFacetSelection(raw);
  if (
    facets.read?.length !== 1 ||
    !['unread', 'read'].includes(facets.read[0])
  ) {
    delete facets.read;
  }
  return facets;
}

const inboxEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: z.enum(['signal', 'noise']).default('signal'),
  facets: z.record(z.string(), z.array(z.string())).optional(),
});

type InboxEntryState = z.infer<typeof inboxEntryStateSchemaWithDefaults>;

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
    tab: 'signal',
    facets: normalizeInboxFacets(state.facets),
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
      return {
        ...current,
        tab: 'signal',
        facets:
          result.success && result.data.facets !== undefined
            ? normalizeInboxFacets(result.data.facets)
            : current.facets,
      };
    },
    select: selectEntryState,
  });
}

export type CreateInboxViewPersistenceOptions = {
  handle: EntryPersistenceHandle;
  userId: Accessor<string | undefined>;
  restoreEntryState?: boolean;
  restorePreferences?: boolean;
};

function createHomeFilterStorage(options: {
  userId: Accessor<string | undefined>;
  restore: boolean;
}): PersistenceStorage<InboxViewState> {
  return {
    restore: (current) => {
      const userId = options.userId();
      if (!options.restore || !userId) return undefined;
      const raw = homeFilterStorage.read(userId);
      if (raw === null) return undefined;
      const result = inboxEntryStateSchemaWithDefaults.safeParse(
        JSON.parse(raw)
      );
      if (!result.success || result.data.facets === undefined) return undefined;
      return {
        ...current,
        facets: normalizeInboxFacets(result.data.facets),
      };
    },
    write: (current) => {
      const userId = options.userId();
      if (userId)
        homeFilterStorage.write(
          userId,
          JSON.stringify(selectEntryState(current))
        );
    },
  };
}

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

/** Shared persistence restores user filters, then the owning split entry. */
export function createInboxViewPersistence(
  options: CreateInboxViewPersistenceOptions
): MakePersistedStateOptions<InboxViewState> {
  return {
    storages: [
      createHomeFilterStorage({
        userId: options.userId,
        restore: options.restorePreferences ?? true,
      }),
      createInboxEntryStorage({
        handle: options.handle,
        restore: options.restoreEntryState ?? true,
      }),
    ],
  };
}
