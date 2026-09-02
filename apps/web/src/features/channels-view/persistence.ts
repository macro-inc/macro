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
import type { ChannelsViewState } from './types';

const CHANNELS_ENTRY_STATE_KEY = 'channels.view';
const channelsLocalStateStorage = createUserScopedStorage(
  'macro:channels:view-state:v1'
);

const channelsExpandedGroupsSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return value;
    }

    const groups = value as Record<string, unknown>;
    return {
      ...groups,
      direct_messages: groups.direct_messages ?? groups['direct-messages'],
    };
  },
  z.object({
    channels: z.boolean().default(true),
    direct_messages: z.boolean().default(true),
  })
);

const channelsEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: z.enum(['browse', 'recents']).default('browse'),
  selectedChannelId: z.string().optional(),
  expandedGroups: channelsExpandedGroupsSchema.default({
    channels: true,
    direct_messages: true,
  }),
});

type ChannelsEntryState = z.infer<typeof channelsEntryStateSchemaWithDefaults>;

const DEFAULT_CHANNELS_ENTRY_STATE: ChannelsEntryState =
  channelsEntryStateSchemaWithDefaults.parse({});
const channelsEntryStateSchema = channelsEntryStateSchemaWithDefaults.catch(
  DEFAULT_CHANNELS_ENTRY_STATE
);

function selectEntryState(state: ChannelsViewState): ChannelsEntryState {
  return {
    version: 1,
    tab: state.tab,
    ...(state.selectedChannelId === undefined
      ? {}
      : { selectedChannelId: state.selectedChannelId }),
    expandedGroups: state.expandedGroups,
  };
}

function restoreChannelsEntryState(
  current: ChannelsViewState,
  stored: unknown
): ChannelsViewState {
  const restored = channelsEntryStateSchema.parse(stored);

  return {
    ...current,
    tab: restored.tab,
    selectedChannelId: restored.selectedChannelId,
    expandedGroups: restored.expandedGroups,
  };
}

function createChannelsEntryStorage(options: {
  handle: EntryPersistenceHandle;
  restore: boolean;
}): PersistenceStorage<ChannelsViewState> {
  return createEntryPersistenceStorage({
    handle: options.handle,
    key: CHANNELS_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      if (!options.restore) return undefined;

      return restoreChannelsEntryState(current, stored);
    },
    select: selectEntryState,
  });
}

function createChannelsLocalStateStorage(options: {
  userId: Accessor<string | undefined>;
  restore: boolean;
}): PersistenceStorage<ChannelsViewState> {
  let previous: string | undefined;
  const serialize = (state: ChannelsViewState) =>
    JSON.stringify(selectEntryState(state));

  return {
    restore: (current) => {
      if (!options.restore) return undefined;

      const userId = options.userId();
      if (!userId) return undefined;

      const raw = channelsLocalStateStorage.read(userId);
      if (raw === null) return undefined;

      try {
        return restoreChannelsEntryState(current, JSON.parse(raw));
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
      channelsLocalStateStorage.write(userId, serialized);
    },
  };
}

export function createChannelsViewPersistence(options: {
  handle: EntryPersistenceHandle;
  userId: Accessor<string | undefined>;
  restoreEntryState?: boolean;
  restoreLocalState?: boolean;
}): MakePersistedStateOptions<ChannelsViewState> {
  return {
    storages: [
      createChannelsLocalStateStorage({
        userId: options.userId,
        restore: options.restoreLocalState ?? true,
      }),
      createChannelsEntryStorage({
        handle: options.handle,
        restore: options.restoreEntryState ?? true,
      }),
    ],
  };
}
