import type { ChannelEntity } from '@entity/types/entity';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { FavoriteEntityType } from '@service-storage/generated/schemas/favoriteEntityType';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsDataSource, ChannelsSources } from '../../../queries';
import { useChannelRailUnreadFilter } from './useChannelRailUnreadFilter';

const row = (id: string): ChannelEntity => ({
  id,
  type: 'channel',
  name: id,
  ownerId: 'owner',
  channelType: 'private',
});
const source = (items: ChannelEntity[]): ChannelsDataSource => ({
  items: () => items,
  isLoading: () => false,
  isFetching: () => false,
  error: () => undefined,
  hasMore: () => false,
  isLoadingMore: () => false,
  loadMore: async () => {},
  refresh: async () => {},
});
const favorite = (
  entityType: FavoriteEntityType,
  entityId: string
): Favorite => ({
  entityType,
  entityId,
  createdAt: '2026-01-01',
  sortOrder: 0,
});
const sources: ChannelsSources = {
  team_channels: source([row('team-read'), row('team-unread')]),
  channels: source([row('read'), row('unread'), row('open')]),
  direct_messages: source([row('dm-read'), row('dm-unread')]),
  recents: source([row('unread'), row('read')]),
  threads: source([row('read')]),
  search: source([row('read'), row('unread')]),
};
const ids = (channels: readonly ChannelEntity[]) =>
  channels.map((channel) => channel.id);

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

describe('channel rail unread filter', () => {
  it('lists only unread conversations and the open one, leaving search whole', () => {
    const [unreadOnly, setUnreadOnly] = createSignal(false);
    const filter = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return useChannelRailUnreadFilter({
        sources,
        favorites: () => [
          favorite('channel', 'unread'),
          favorite('channel', 'read'),
          favorite('document', 'doc'),
        ],
        unreadOnly,
        unreadChannelIds: () => new Set(['unread', 'dm-unread', 'team-unread']),
        isSelected: (channelId) => channelId === 'open',
      });
    });

    expect(ids(filter.sources.channels.items())).toEqual([
      'read',
      'unread',
      'open',
    ]);
    expect(filter.favorites()).toHaveLength(3);

    setUnreadOnly(true);

    expect(ids(filter.sources.channels.items())).toEqual(['unread', 'open']);
    expect(ids(filter.sources.team_channels.items())).toEqual(['team-unread']);
    expect(ids(filter.sources.direct_messages.items())).toEqual(['dm-unread']);
    expect(ids(filter.sources.recents.items())).toEqual(['unread']);
    expect(filter.sources.threads.items()).toEqual([]);
    expect(ids(filter.sources.search.items())).toEqual(['read', 'unread']);
    expect(filter.favorites().map((item) => item.entityId)).toEqual(['unread']);
  });

  it('pages a filtered list until it fills while the filter is on', () => {
    const [unreadOnly, setUnreadOnly] = createSignal(false);
    const loadMore = vi.fn(async () => {});
    const paged = {
      ...source([row('read'), row('unread')]),
      hasMore: () => true,
      loadMore,
    };
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return useChannelRailUnreadFilter({
        sources: { ...sources, channels: paged },
        favorites: () => [],
        unreadOnly,
        unreadChannelIds: () => new Set(['unread']),
        isSelected: () => false,
      });
    });

    expect(loadMore).not.toHaveBeenCalled();

    setUnreadOnly(true);

    expect(loadMore).toHaveBeenCalledOnce();
  });
});
