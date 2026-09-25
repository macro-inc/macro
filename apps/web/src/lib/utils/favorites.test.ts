import type { PreviewItem } from '@queries/preview';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const [preview, setPreview] = createSignal<PreviewItem>({
  loading: true,
  id: 'channel-1',
  type: 'channel',
} as PreviewItem);

vi.mock('@queries/preview', () => ({
  isAccessiblePreviewItem: (item: PreviewItem) =>
    !item.loading && item.access === 'access',
  useItemPreview: () => [preview],
}));
vi.mock('@queries/favorites/favorites', () => ({
  favoriteEntityKey: (entityType: string, entityId: string) =>
    `${entityType}:${entityId}`,
}));
vi.mock('@core/component/EntityIcon', () => ({
  getIconConfig: () => ({ prettyName: 'Channel' }),
}));
vi.mock('@core/constant/allBlocks', () => ({ fileTypeToBlockName: vi.fn() }));
vi.mock('@block-channel/utils/link', () => ({ getChannelParams: vi.fn() }));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));
vi.mock('@core/context/user', () => ({ useUserId: vi.fn() }));
vi.mock('@service-storage/client', () => ({ ChannelTypeEnum: {} }));

import { useFavoriteDisplayName } from './favorites';

let entityId = 0;
const disposers: (() => void)[] = [];

function channelFavorite(): Favorite {
  entityId += 1;
  return {
    entityType: 'channel',
    entityId: `channel-${entityId}`,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function loading(): PreviewItem {
  return { loading: true, id: 'channel', type: 'channel' } as PreviewItem;
}

function resolved(name: string): PreviewItem {
  return {
    loading: false,
    access: 'access',
    id: 'channel',
    type: 'channel',
    name,
    rawName: name,
  } as PreviewItem;
}

function mountName(favorite: Favorite) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return useFavoriteDisplayName(favorite);
  });
}

describe('useFavoriteDisplayName', () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    setPreview(loading());
  });

  it('shows the entity kind until a preview first resolves', () => {
    const name = mountName(channelFavorite());
    expect(name()).toBe('Channel');
    setPreview(resolved('general'));
    expect(name()).toBe('general');
  });

  it('keeps the resolved name while a remounted row reconnects', () => {
    const favorite = channelFavorite();
    const first = mountName(favorite);
    setPreview(resolved('general'));
    expect(first()).toBe('general');
    for (const dispose of disposers.splice(0)) dispose();

    setPreview(loading());
    const remounted = mountName(favorite);
    expect(remounted()).toBe('general');
    setPreview(resolved('general-renamed'));
    expect(remounted()).toBe('general-renamed');
  });

  it('forgets the name once the favorite is no longer accessible', () => {
    const favorite = channelFavorite();
    const first = mountName(favorite);
    setPreview(resolved('general'));
    expect(first()).toBe('general');
    setPreview({
      loading: false,
      access: 'no_access',
      id: 'channel',
      type: 'channel',
    } as PreviewItem);
    expect(first()).toBe('Channel');
    for (const dispose of disposers.splice(0)) dispose();

    setPreview(loading());
    expect(mountName(favorite)()).toBe('Channel');
  });
});
