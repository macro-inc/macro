import type {
  MakePersistedStateOptions,
  PersistenceStorage,
} from '@app/lib/persistence';
import {
  createEntryPersistenceStorage,
  type EntryPersistenceHandle,
} from '@components/app/split-layout/entry-persistence';
import { z } from 'zod';
import type { ChannelsViewState } from './types';

const CHANNELS_ENTRY_STATE_KEY = 'channels.view';

const channelsEntryStateSchemaWithDefaults = z.object({
  version: z.literal(1).default(1),
  tab: z.enum(['browse', 'recents']).default('browse'),
  selectedChannelId: z.string().optional(),
  expandedGroups: z
    .object({
      channels: z.boolean().default(true),
      'direct-messages': z.boolean().default(true),
    })
    .default({ channels: true, 'direct-messages': true }),
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

function createChannelsEntryStorage(options: {
  handle: EntryPersistenceHandle;
  restore: boolean;
}): PersistenceStorage<ChannelsViewState> {
  return createEntryPersistenceStorage({
    handle: options.handle,
    key: CHANNELS_ENTRY_STATE_KEY,
    restore: (current, stored) => {
      if (!options.restore) return undefined;

      const restored = channelsEntryStateSchema.parse(stored);

      return {
        ...current,
        tab: restored.tab,
        selectedChannelId: restored.selectedChannelId,
        expandedGroups: restored.expandedGroups,
      };
    },
    select: selectEntryState,
  });
}

export function createChannelsViewPersistence(options: {
  handle: EntryPersistenceHandle;
  restoreEntryState?: boolean;
}): MakePersistedStateOptions<ChannelsViewState> {
  return {
    storages: [
      createChannelsEntryStorage({
        handle: options.handle,
        restore: options.restoreEntryState ?? true,
      }),
    ],
  };
}
