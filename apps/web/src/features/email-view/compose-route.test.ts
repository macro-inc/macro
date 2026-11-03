import {
  createRoutesManifest,
  decodePane,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  emailComposeRoute,
  emailSplitRoute,
  emailThreadRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { createAppSplitRouterMiddleware } from '@components/app/split-layout/split-router/app-middleware';
import { describe, expect, it, vi } from 'vitest';

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
        {
          ...emailSplitRoute,
          children: [emailComposeRoute, emailThreadRoute],
        },
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: emailSplitRoute.id, params: {} }),
} satisfies SplitRoutes);

function openCompose(touch: boolean) {
  const to: Entry = {
    id: 'entry',
    location: {
      route: paneRoute({
        id: legacyContentRoute.id,
        params: { type: 'component', id: 'email-compose' },
      }),
    },
  };
  for (const handler of createAppSplitRouterMiddleware({
    isTouchDevice: () => touch,
  })) {
    const result = handler({
      routes,
      from: undefined,
      to,
      path: '/component/email-compose',
      cause: 'navigate',
      externalSearch: undefined,
      signal: new AbortController().signal,
      redirect: (path) => ({ type: 'redirect', to: path }),
      cancel: () => ({ type: 'cancel' }),
    });
    if (result instanceof Promise) throw new Error('Unexpected async');
    if (result) return result;
  }
  return undefined;
}

describe('new email in the Email view', () => {
  it('opens a new email beside the list on desktop', () => {
    expect(openCompose(false)).toEqual({ type: 'redirect', to: '/mail/new' });
  });

  it('keeps the full-screen composer on touch', () => {
    expect(openCompose(true)).toBeUndefined();
  });

  it('reads /mail/new as a new email, not a thread', () => {
    expect(decodePane(routes, ['mail', 'new'])?.matches.at(-1)?.id).toBe(
      emailComposeRoute.id
    );
    expect(decodePane(routes, ['mail', 'thread-1'])?.matches.at(-1)).toEqual({
      id: emailThreadRoute.id,
      params: { threadId: 'thread-1' },
    });
  });
});
