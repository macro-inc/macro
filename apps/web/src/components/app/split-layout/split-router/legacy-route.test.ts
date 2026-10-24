import {
  createRoutesManifest,
  decodePane,
  type SplitRoutes,
} from '@app/lib/split-router';
import {
  appRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { describe, expect, it, vi } from 'vitest';
import { createAppSplitRouterMiddleware } from './app-middleware';
import { resolveContentLocation, upgradeLegacyPath } from './legacy-route';
import { createMacroMentionLinkResolver } from './mention-links';

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

describe('legacy link mentions', () => {
  const resolveMention = createMacroMentionLinkResolver(routes);
  const projectId = '01a15f1b-5b91-7aa3-885d-7d31fcc5a776';
  const appUrl = (path: string) => `${window.location.origin}/app${path}`;

  it.each([
    `/component/initiative-view~${projectId}~overview?referral_code=abc`,
    `/component/initiative-view~${projectId}~tasks`,
    `/home/~/component/initiative-view~${projectId}~overview`,
  ])('pastes a shared project link %s as a project mention', (path) => {
    expect(resolveMention(appUrl(path))).toEqual({
      id: projectId,
      block: 'initiative',
      params: {},
    });
  });

  it('opens a shared project link in Tasks', () => {
    const middleware = createAppSplitRouterMiddleware({
      isTouchDevice: () => false,
    });
    const results = middleware.map((handler) => {
      const result = handler({
        routes,
        from: undefined,
        to: {
          id: 'entry',
          location: { route: decodePane(routes, ['initiative', projectId])! },
        },
        path: '',
        cause: 'navigate',
        signal: new AbortController().signal,
        redirect: (path) => ({ type: 'redirect', to: path }),
        cancel: () => ({ type: 'cancel' }),
      });
      if (result instanceof Promise) throw new Error('Unexpected async');
      return result;
    });
    const redirect = results.find((result) => result !== undefined);
    if (redirect?.type !== 'redirect') throw new Error('Expected a redirect');
    expect(new URL(redirect.to, window.location.origin).pathname).toBe(
      `/tasks/projects/${projectId}/overview`
    );
  });

  it('pastes a legacy block pane as a mention of its block', () => {
    expect(resolveMention(appUrl(`/home/~/md/${projectId}`))).toEqual({
      id: projectId,
      block: 'md',
      params: {},
    });
  });

  it.each([
    '/component/initiative-view~not-a-uuid~overview',
    '/component/settings',
    '/md/not-a-uuid',
  ])('leaves %s as a link', (path) => {
    expect(resolveMention(appUrl(path))).toBeUndefined();
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
