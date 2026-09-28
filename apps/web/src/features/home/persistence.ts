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
import type { HomeViewState } from './types';

export const HOME_ENTRY_STATE_KEY = 'home.view';
export const HOME_LIST_ENTRY_STATE_KEY = 'home.listState';
const homeFilterStorage = createUserScopedStorage('macro:home:filters:v1');

/** Status is a single choice; an empty selection means All. */
export function normalizeHomeFacets(raw: unknown) {
  const facets = normalizeFacetSelection(raw);
  if (
    facets.read?.length !== 1 ||
    !['unread', 'read'].includes(facets.read[0])
  ) {
    delete facets.read;
  }
  return facets;
}

const homeEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: z.enum(['signal', 'noise']).default('signal'),
  facets: z.record(z.string(), z.array(z.string())).optional(),
});

type HomeEntryState = z.infer<typeof homeEntryStateSchemaWithDefaults>;

const homeListEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  focusKey: z.string().optional(),
  scrollOffset: z.number().finite().default(0),
});

type HomeListEntryState = z.infer<typeof homeListEntryStateSchemaWithDefaults>;

const DEFAULT_HOME_LIST_ENTRY_STATE = {
  version: 1,
  focusKey: undefined,
  scrollOffset: 0,
} satisfies HomeListEntryState;

export type HomeListStateSnapshot = {
  focusKey: HomeListEntryState['focusKey'];
  scrollOffset: HomeListEntryState['scrollOffset'];
};

export const DEFAULT_HOME_LIST_STATE: HomeListStateSnapshot = {
  focusKey: undefined,
  scrollOffset: 0,
};

function selectEntryState(state: HomeViewState): HomeEntryState {
  return {
    version: 1,
    tab: 'signal',
    facets: normalizeHomeFacets(state.facets),
  };
}

function createHomeEntryStorage(options: {
  handle: EntryPersistenceHandle;
  restore: boolean;
}): PersistenceStorage<HomeViewState> {
  return createEntryPersistenceStorage({
    handle: options.handle,
    key: HOME_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      if (!options.restore) return undefined;
      const result = homeEntryStateSchemaWithDefaults.safeParse(stored);
      return {
        ...current,
        tab: 'signal',
        facets:
          result.success && result.data.facets !== undefined
            ? normalizeHomeFacets(result.data.facets)
            : current.facets,
      };
    },
    select: selectEntryState,
  });
}

export type CreateHomeViewPersistenceOptions = {
  handle: EntryPersistenceHandle;
  userId: Accessor<string | undefined>;
  restoreEntryState?: boolean;
  restorePreferences?: boolean;
};

function createHomeFilterStorage(options: {
  userId: Accessor<string | undefined>;
  restore: boolean;
}): PersistenceStorage<HomeViewState> {
  return {
    restore: (current) => {
      const userId = options.userId();
      if (!options.restore || !userId) return undefined;
      const raw = homeFilterStorage.read(userId);
      if (raw === null) return undefined;
      const result = homeEntryStateSchemaWithDefaults.safeParse(
        JSON.parse(raw)
      );
      if (!result.success || result.data.facets === undefined) return undefined;
      return {
        ...current,
        facets: normalizeHomeFacets(result.data.facets),
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

export function createHomeListEntryStorage(
  handle: EntryPersistenceHandle
): PersistenceStorage<HomeListStateSnapshot> {
  return createEntryPersistenceStorage({
    handle,
    key: HOME_LIST_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      const result = homeListEntryStateSchemaWithDefaults.safeParse(stored);
      const restored = result.success
        ? result.data
        : DEFAULT_HOME_LIST_ENTRY_STATE;

      return {
        ...current,
        focusKey: restored.focusKey,
        scrollOffset: restored.scrollOffset,
      };
    },
    select: (state): HomeListEntryState => ({
      version: 1,
      ...(state.focusKey === undefined ? {} : { focusKey: state.focusKey }),
      scrollOffset: state.scrollOffset,
    }),
  });
}

/** Shared persistence restores user filters, then the owning split entry. */
export function createHomeViewPersistence(
  options: CreateHomeViewPersistenceOptions
): MakePersistedStateOptions<HomeViewState> {
  return {
    storages: [
      createHomeFilterStorage({
        userId: options.userId,
        restore: options.restorePreferences ?? true,
      }),
      createHomeEntryStorage({
        handle: options.handle,
        restore: options.restoreEntryState ?? true,
      }),
    ],
  };
}
