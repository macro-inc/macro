import { createCollapsedSidebarSectionsStorage } from '@app/components/view-shell';
import { INBOX_FILTER_ENTRY_KEY } from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import { normalizeFacetSelection } from '@app/features/soup';
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
import type { EmailViewState } from './types';

const EMAIL_ENTRY_STATE_KEY = 'email.view';
const EMAIL_LIST_ENTRY_STATE_KEY = 'email.listState';
const emailLocalStateStorage = createUserScopedStorage(
  'macro:email:view-state:v1'
);

const emailTabSchema = z
  .enum(['important', 'noise', 'sent', 'calendar', 'drafts', 'shared', 'all'])
  .catch('important');

const emailFacetsSchema = z.record(z.string(), z.array(z.string()));

const emailEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: emailTabSchema.default('important'),
  search: z.string().default(''),
  facets: emailFacetsSchema.default({}),
  openThreadId: z.string().optional(),
});

type EmailEntryState = z.infer<typeof emailEntryStateSchemaWithDefaults>;

const DEFAULT_EMAIL_ENTRY_STATE: EmailEntryState =
  emailEntryStateSchemaWithDefaults.parse({});
const emailEntryStateSchema = emailEntryStateSchemaWithDefaults.catch(
  DEFAULT_EMAIL_ENTRY_STATE
);

// The legacy mail view stores the raw `string[] | undefined` under its key;
// anything else restores as "every inbox".
const inboxIdsEntrySchema = z.array(z.string()).optional().catch(undefined);

const emailListStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  focusKey: z.string().optional(),
  scrollOffset: z.number().finite().default(0),
});

type EmailListEntryState = z.infer<typeof emailListStateSchemaWithDefaults>;

const DEFAULT_EMAIL_LIST_ENTRY_STATE: EmailListEntryState =
  emailListStateSchemaWithDefaults.parse({});
const emailListStateSchema = emailListStateSchemaWithDefaults.catch(
  DEFAULT_EMAIL_LIST_ENTRY_STATE
);

export type EmailListStateSnapshot = {
  focusKey: EmailListEntryState['focusKey'];
  scrollOffset: EmailListEntryState['scrollOffset'];
};

export const DEFAULT_EMAIL_LIST_STATE: EmailListStateSnapshot = {
  focusKey: DEFAULT_EMAIL_LIST_ENTRY_STATE.focusKey,
  scrollOffset: DEFAULT_EMAIL_LIST_ENTRY_STATE.scrollOffset,
};

function createEmailEntryStorage(options: {
  handle: EntryPersistenceHandle;
  restore: boolean;
}): PersistenceStorage<EmailViewState> {
  return createEntryPersistenceStorage({
    handle: options.handle,
    key: EMAIL_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      if (!options.restore) return undefined;

      const restored = emailEntryStateSchema.parse(stored);
      return {
        ...current,
        tab: restored.tab,
        search: restored.search,
        facets: normalizeFacetSelection(restored.facets),
        openThreadId: restored.openThreadId,
      };
    },
    select: (state): EmailEntryState => ({
      version: 1,
      tab: state.tab,
      search: state.search,
      facets: normalizeFacetSelection(state.facets),
      ...(state.openThreadId === undefined
        ? {}
        : { openThreadId: state.openThreadId }),
    }),
  });
}

// Split entry state is gone after a reload, so the parts of the view worth
// coming back to — tab, inbox scope, filters, and the open thread — are also
// kept per user, the way the Channels view keeps its selected channel. The
// search text is deliberately per visit.
const emailLocalStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: emailTabSchema.default('important'),
  inboxIds: inboxIdsEntrySchema,
  facets: emailFacetsSchema.default({}),
  openThreadId: z.string().optional(),
});

type EmailLocalState = z.infer<typeof emailLocalStateSchemaWithDefaults>;

const DEFAULT_EMAIL_LOCAL_STATE: EmailLocalState =
  emailLocalStateSchemaWithDefaults.parse({});
const emailLocalStateSchema = emailLocalStateSchemaWithDefaults.catch(
  DEFAULT_EMAIL_LOCAL_STATE
);

function selectLocalState(state: EmailViewState): EmailLocalState {
  return {
    version: 1,
    tab: state.tab,
    ...(state.inboxIds === undefined ? {} : { inboxIds: [...state.inboxIds] }),
    facets: normalizeFacetSelection(state.facets),
    ...(state.openThreadId === undefined
      ? {}
      : { openThreadId: state.openThreadId }),
  };
}

function createEmailLocalStateStorage(options: {
  userId: Accessor<string | undefined>;
  restore: boolean;
}): PersistenceStorage<EmailViewState> {
  let previous: string | undefined;
  const serialize = (state: EmailViewState) =>
    JSON.stringify(selectLocalState(state));

  return {
    restore: (current) => {
      if (!options.restore) return undefined;

      const userId = options.userId();
      if (!userId) return undefined;

      const raw = emailLocalStateStorage.read(userId);
      if (raw === null) return undefined;

      try {
        const restored = emailLocalStateSchema.parse(JSON.parse(raw));
        return {
          ...current,
          tab: restored.tab,
          inboxIds: restored.inboxIds,
          facets: normalizeFacetSelection(restored.facets),
          openThreadId: restored.openThreadId,
        };
      } catch {
        return undefined;
      }
    },
    initialize: (current) => {
      previous = serialize(current);
    },
    write: (current) => {
      const userId = options.userId();
      if (!userId) return;

      const serialized = serialize(current);
      if (serialized === previous) return;

      previous = serialized;
      emailLocalStateStorage.write(userId, serialized);
    },
  };
}

/**
 * The inbox selection lives under the legacy mail view's entry key rather
 * than in `email.view`: the classic sidebar's nested account rows read that
 * key off a mail history entry while another view is on top, and a selection
 * made in either implementation survives flipping the new-views flag.
 */
function createInboxIdsEntryStorage(options: {
  handle: EntryPersistenceHandle;
  restore: boolean;
}): PersistenceStorage<EmailViewState> {
  return createEntryPersistenceStorage({
    handle: options.handle,
    key: INBOX_FILTER_ENTRY_KEY,
    restore: (current, stored) => {
      if (!options.restore) return undefined;

      return { ...current, inboxIds: inboxIdsEntrySchema.parse(stored) };
    },
    select: (state): string[] | undefined =>
      state.inboxIds === undefined ? undefined : [...state.inboxIds],
  });
}

export function createEmailListEntryStorage(
  handle: EntryPersistenceHandle
): PersistenceStorage<EmailListStateSnapshot> {
  return createEntryPersistenceStorage({
    handle,
    key: EMAIL_LIST_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      const restored = emailListStateSchema.parse(stored);

      return {
        ...current,
        focusKey: restored.focusKey,
        scrollOffset: restored.scrollOffset,
      };
    },
    select: (state): EmailListEntryState => ({
      version: 1,
      ...(state.focusKey === undefined ? {} : { focusKey: state.focusKey }),
      scrollOffset: state.scrollOffset,
    }),
  });
}

export type CreateEmailViewPersistenceOptions = {
  handle: EntryPersistenceHandle;
  userId: Accessor<string | undefined>;
  restoreEntryState?: boolean;
  restoreLocalState?: boolean;
  restorePreferences?: boolean;
};

/**
 * Persists Email navigation state with the owning split entry, and the parts
 * worth restoring after a reload per user. Later storages take precedence on
 * restore, so a live entry wins over the user-level copy.
 */
export function createEmailViewPersistence(
  options: CreateEmailViewPersistenceOptions
): MakePersistedStateOptions<EmailViewState> {
  const restore = options.restoreEntryState ?? true;

  return {
    storages: [
      createCollapsedSidebarSectionsStorage({
        key: 'macro:email:preferences:v1',
        userId: options.userId,
        restore: options.restorePreferences ?? true,
      }),
      createEmailLocalStateStorage({
        userId: options.userId,
        restore: options.restoreLocalState ?? true,
      }),
      createEmailEntryStorage({ handle: options.handle, restore }),
      createInboxIdsEntryStorage({ handle: options.handle, restore }),
    ],
  };
}
