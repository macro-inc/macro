import {
  spreadsheetDetailSearch,
  spreadsheetDetailSearchCodec,
} from '@app/features/block-spreadsheet/spreadsheet-route';
import { createRoutesManifest, type SplitRoutes } from '@app/lib/split-router';
import {
  appRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import {
  chatDetailSearch,
  chatDetailSearchCodec,
} from '@block-chat/chat-route';
import { describe, expect, it, vi } from 'vitest';
import {
  decodeLegacyPair,
  resolveContentLocation,
  upgradeLegacyPath,
} from './legacy-route';

vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: vi.fn(() => ({ type: 'mock-component' })),
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

const routes = createRoutesManifest({
  definitions: [
    {
      ...appRoute,
      children: [homeSplitRoute, legacyContentRoute, notFoundRoute],
    },
  ],
  defaultRoute: () => ({ matches: [{ id: 'view-home', params: {} }] }),
} satisfies SplitRoutes);

describe('upgradeLegacyPath', () => {
  it('sends the retired Getting Started path to Home', () => {
    expect(upgradeLegacyPath(routes, '/getting-started')).toBe('/home');
  });

  it.each(['chat', 'spreadsheet'] as const)(
    'resolves %s routes without a legacy block definition',
    (type) => {
      const id = '00000000-0000-4000-8000-000000000001';
      expect(decodeLegacyPair(type, id)).toEqual({ type, id });
      expect(
        resolveContentLocation(routes, { type, id }).route.matches.at(-1)
      ).toEqual({
        id: 'legacy-content',
        params: { type, id },
      });
    }
  );

  it.each(['chat', 'spreadsheet'] as const)(
    'carries explicit %s params into feature route search',
    (type) => {
      const id = '00000000-0000-4000-8000-000000000001';
      const params =
        type === 'chat'
          ? { message_id: 'target', share: 'true' }
          : { comment_id: 'target', share: 'true' };
      const location = resolveContentLocation(routes, { type, id, params });
      if (type === 'chat') {
        expect(
          chatDetailSearchCodec.parse(
            location.search?.[chatDetailSearch.namespace]
          ).value
        ).toMatchObject({
          chatId: id,
          messageId: 'target',
          share: 'true',
          seek: expect.any(String),
        });
      } else {
        expect(
          spreadsheetDetailSearchCodec.parse(
            location.search?.[spreadsheetDetailSearch.namespace]
          ).value
        ).toMatchObject({
          documentId: id,
          commentId: 'target',
          share: 'true',
          seek: expect.any(String),
        });
      }
    }
  );
  it('rejects unregistered block names', () => {
    expect(decodeLegacyPair('not-a-block', 'id')).toBeUndefined();
  });
});
