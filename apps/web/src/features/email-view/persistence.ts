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
import { z } from 'zod';
import type { EmailViewState } from './types';

const EMAIL_ENTRY_STATE_KEY = 'email.view';
const EMAIL_LIST_ENTRY_STATE_KEY = 'email.listState';

const emailTabSchema = z
  .enum(['important', 'noise', 'sent', 'calendar', 'drafts', 'shared', 'all'])
  .catch('important');

const emailFacetsSchema = z.record(z.string(), z.array(z.string()));

const emailEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: emailTabSchema.default('important'),
  search: z.string().default(''),
  facets: emailFacetsSchema.default({}),
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
      };
    },
    select: (state): EmailEntryState => ({
      version: 1,
      tab: state.tab,
      search: state.search,
      facets: normalizeFacetSelection(state.facets),
    }),
  });
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
  restoreEntryState?: boolean;
};

/** Persists Email navigation state with the owning split entry. */
export function createEmailViewPersistence(
  options: CreateEmailViewPersistenceOptions
): MakePersistedStateOptions<EmailViewState> {
  const restore = options.restoreEntryState ?? true;

  return {
    storages: [
      createEmailEntryStorage({ handle: options.handle, restore }),
      createInboxIdsEntryStorage({ handle: options.handle, restore }),
    ],
  };
}
