import { createRoutesManifest, type SplitRoutes } from '@app/lib/split-router';
import {
  appRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { describe, expect, it, vi } from 'vitest';
import { resolveContentLocation, upgradeLegacyPath } from './legacy-route';

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
});

describe('resolveContentLocation', () => {
  it.each(['company', 'contact'] as const)(
    'keeps the Discussion message a %s opens at',
    (type) => {
      const location = resolveContentLocation(routes, {
        type,
        id: 'record',
        params: { comment_id: 'message' },
      });
      expect(location.search).toEqual({
        'crm-record': { commentId: ['message'], seek: [expect.any(String)] },
      });
    }
  );

  it('adds no message to a record opened without one', () => {
    expect(
      resolveContentLocation(routes, { type: 'company', id: 'record' }).search
    ).toBeUndefined();
  });
});
