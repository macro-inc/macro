import { createRoutesManifest, type SplitRoutes } from '@app/lib/split-router';
import {
  appRoute,
  externalRoute,
  externalWhatsappGroupRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
  whatsappGroupRoute,
} from '@app/routes/routes';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveContentLocation,
  splitContentFromLocation,
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
      children: [
        homeSplitRoute,
        { ...externalRoute, children: [externalWhatsappGroupRoute] },
        whatsappGroupRoute,
        legacyContentRoute,
        notFoundRoute,
      ],
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

it('restores a saved WhatsApp group component inside External', () => {
  const location = resolveContentLocation(routes, {
    type: 'component',
    id: 'whatsapp-group:019a061e-0000-7000-8000-000000000001',
  });
  expect(location.route.matches.slice(1)).toEqual([
    { id: 'view-external', params: {} },
    {
      id: 'external-whatsapp-group',
      params: { groupId: '019a061e-0000-7000-8000-000000000001' },
    },
  ]);
  expect(splitContentFromLocation(location)).toEqual({
    type: 'component',
    id: 'external',
  });
});
