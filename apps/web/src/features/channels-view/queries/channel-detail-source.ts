import type { ChannelEntity, EntityData } from '@entity/types/entity';
import { type Accessor, createMemo, on } from 'solid-js';
import type { ChannelDetailSource } from '../context/channel-detail-source';

type ChannelDetailQuery = {
  readonly isEnabled: boolean;
  readonly isPending: boolean;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly error: Error | null;
  readonly data: { entities: EntityData[] } | undefined;
  refresh: () => Promise<void>;
};

export function createChannelDetailSource(options: {
  channelId: Accessor<string | undefined>;
  cached: Accessor<ChannelEntity | undefined>;
  createQuery: (
    channelId: Accessor<string | undefined>,
    enabled: Accessor<boolean>
  ) => ChannelDetailQuery;
}): ChannelDetailSource {
  // Decide once per open. Subsequent list updates must not restart hydration.
  // A defined unreadNotifications field identifies the abbreviated list query,
  // including []; legacy/full rows already have a notification source.
  const refreshOnOpen = createMemo(
    on(options.channelId, () => {
      const cached = options.cached();
      return !cached || cached.unreadNotifications !== undefined;
    })
  );
  const query = options.createQuery(
    options.channelId,
    () =>
      options.channelId() !== undefined &&
      (refreshOnOpen() || !options.cached())
  );

  return {
    load: () => {
      const id = options.channelId();
      if (!id) return { status: 'pending' };
      if (query.isEnabled && query.error)
        return { status: 'error', error: query.error };
      if (!refreshOnOpen() && options.cached()) {
        return { status: 'ready', channel: options.cached() };
      }
      if (!query.isEnabled) return { status: 'pending' };
      if (query.isPending || query.isLoading || query.isFetching)
        return { status: 'pending' };
      const channel = query.data?.entities.find(
        (entity): entity is ChannelEntity =>
          entity.type === 'channel' && entity.id === id
      );
      return { status: 'ready', channel };
    },
    refresh: () => query.refresh(),
  };
}
