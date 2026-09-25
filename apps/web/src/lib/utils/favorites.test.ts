import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { describe, expect, it, vi } from 'vitest';
import { favoriteBlockName, favoriteSplitContent } from './favorites';

// Keep this routing test independent of the eager block registry and icon UI.
vi.mock('@core/component/EntityIcon', () => ({
  getIconConfig: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type: string) => type,
}));
vi.mock('@queries/preview', () => ({
  useItemPreview: vi.fn(),
  isAccessiblePreviewItem: vi.fn(),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const pullRequestFavorite: Favorite = {
  entityType: 'foreign_entity',
  entityId: 'pr-1',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('foreign-entity favorites', () => {
  it('uses the PR icon and opens the detail in the Reviews shell', () => {
    expect(favoriteBlockName(pullRequestFavorite)).toBe('pr');
    expect(favoriteSplitContent(pullRequestFavorite)).toEqual({
      type: 'component',
      id: 'reviews',
      entryMetadata: {
        route: {
          matches: [
            { id: 'view-reviews', params: {} },
            { id: 'reviews-pr', params: { foreignEntityId: 'pr-1' } },
          ],
        },
      },
    });
  });
});
