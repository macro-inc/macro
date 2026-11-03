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

const legacyCompose: Entry = {
  id: 'entry',
  location: {
    route: paneRoute({
      id: legacyContentRoute.id,
      params: { type: 'component', id: 'email-compose' },
    }),
  },
};

const newEmail: Entry = {
  id: 'entry',
  location: {
    route: paneRoute(
      { id: emailSplitRoute.id, params: {} },
      { id: emailComposeRoute.id, params: {} }
    ),
  },
};

function run(
  to: Entry,
  options: { touch?: boolean; path: string; externalSearch?: string }
) {
  for (const handler of createAppSplitRouterMiddleware({
    isTouchDevice: () => options.touch ?? false,
  })) {
    const result = handler({
      routes,
      from: undefined,
      to,
      path: options.path,
      cause: options.externalSearch ? 'external' : 'navigate',
      externalSearch: options.externalSearch,
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
  it('opens a new email in the Email view on desktop', () => {
    expect(run(legacyCompose, { path: '/component/email-compose' })).toEqual({
      type: 'redirect',
      to: '/mail/new',
    });
  });

  it('keeps the full-screen composer on touch', () => {
    expect(
      run(legacyCompose, { touch: true, path: '/component/email-compose' })
    ).toBeUndefined();
  });

  it('keeps the recipients a `?to=` link names', () => {
    const result = run(newEmail, {
      path: '/mail/new',
      externalSearch: 'to=a@example.com,b@example.com',
    });
    if (result?.type !== 'redirect') throw new Error('Expected a redirect');
    const url = new URL(result.to, window.location.origin);
    expect(url.pathname).toBe('/mail/new');
    expect(url.searchParams.get('s0.email-compose.to')).toBe(
      'a@example.com,b@example.com'
    );
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
