import type { openPipedreamConnectUI } from '@core/pipedream/connect-ui';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  complete: vi.fn(),
  recover: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(async () => {}),
  native: false,
  openNative: vi.fn(),
  userId: 'user-one',
  token: vi.fn(),
  startAuth: vi.fn(),
  fetchServers: vi.fn(),
  reservePopup: vi.fn(),
  assignUrl: vi.fn(),
  overlays: [] as { app_slug: string; server_url: string }[],
  overlaysUnavailable: false,
  cachedOverlays: undefined as
    | { app_slug: string; server_url: string }[]
    | undefined,
}));
vi.mock('@core/util/platform', () => ({ isTauri: () => mocks.native }));
vi.mock('@core/pipedream/connect-native', () => ({
  openNativePipedreamConnectUI: mocks.openNative,
}));
vi.mock('@core/pipedream/connect-ui', () => ({
  openPipedreamConnectUI: mocks.open,
}));
vi.mock('@core/pipedream/oauth-popup', () => ({
  reserveOauthPopup: mocks.reservePopup,
  assignOauthUrl: mocks.assignUrl,
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    setQueryData: mocks.setData,
    invalidateQueries: mocks.invalidate,
    getQueryData: (key: readonly unknown[]) =>
      key[1] === 'overlays' ? mocks.cachedOverlays : { id: mocks.userId },
    ensureQueryData: async () => {
      if (mocks.overlaysUnavailable) throw new Error('404');
      return mocks.overlays;
    },
    fetchQuery: mocks.fetchServers,
  },
}));
vi.mock('@service-cognition/client', () => ({
  PIPEDREAM_DISABLED: 'PIPEDREAM_DISABLED',
  cognitionApiServiceClient: {
    createPipedreamToken: mocks.token,
    completePipedreamConnection: mocks.complete,
    startMcpAuth: mocks.startAuth,
    recoverPipedreamConnection: mocks.recover,
  },
}));

import { connectPipedreamApp, overlaidAppSlug } from './pipedream-connectors';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = false;
  mocks.userId = 'user-one';
  mocks.overlays = [];
  mocks.overlaysUnavailable = false;
  mocks.cachedOverlays = undefined;
  mocks.token.mockImplementation(async () => ok({ token: 'fixture' }));
  mocks.open.mockImplementation(() => ({ close: mocks.close }));
  mocks.openNative.mockImplementation(() => ({ close: mocks.close }));
  mocks.recover.mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
  );
});

async function connect(native = false) {
  mocks.native = native;
  const opened =
    Promise.withResolvers<Parameters<typeof openPipedreamConnectUI>[0]>();
  (native ? mocks.openNative : mocks.open).mockImplementation((options) => {
    opened.resolve(options);
    return { close: mocks.close };
  });
  const pending = connectPipedreamApp({
    appSlug: 'linear',
    serverName: 'Linear',
  });
  const { onEvent } = await opened.promise;
  return { pending, event: onEvent };
}

describe('verified Pipedream connection completion', () => {
  it('does not attach a browser result after the user changes accounts', async () => {
    const { pending, event } = await connect();
    mocks.userId = 'user-two';
    event({ type: 'success', accountId: 'apn_test' });
    expect(await pending).toBe('closed');
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('does not populate another account cache when registration finishes late', async () => {
    let complete!: (value: { app_slug: string; enabled: boolean }) => void;
    mocks.complete.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = (connection) => resolve(ok(connection));
        })
    );
    const { pending, event } = await connect();
    event({ type: 'success', accountId: 'apn_test' });
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalled());
    mocks.userId = 'user-two';
    complete({ app_slug: 'linear', enabled: true });
    expect(await pending).toBe('closed');
    expect(mocks.setData).not.toHaveBeenCalled();
  });
  it('opens native consent in the browser and verifies the returned account before success', async () => {
    mocks.complete.mockResolvedValue(ok({ app_slug: 'linear', enabled: true }));
    const { pending, event } = await connect(true);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    event({
      type: 'success',
      accountId: 'apn_test',
    });
    expect(await pending).toBe('connected');
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith({
      account_id: 'apn_test',
      server_name: 'Linear',
    });
  });
  it('reports success only after the requested enabled connection is registered', async () => {
    mocks.complete.mockResolvedValue(ok({ app_slug: 'linear', enabled: true }));
    const { pending, event } = await connect();
    event({ type: 'success', accountId: 'apn_test' });
    event({ type: 'success', accountId: 'apn_test' });
    expect(await pending).toBe('connected');
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each([
    { app_slug: 'slack', enabled: true },
    { app_slug: 'linear', enabled: false },
  ])(
    'does not report connected for $app_slug with enabled=$enabled',
    async (connection) => {
      mocks.complete.mockResolvedValue(ok(connection));
      const { pending, event } = await connect();
      const rejected = expect(pending).rejects.toThrow(
        'requested connector was not enabled'
      );
      event({ type: 'success', accountId: 'apn_test' });
      await rejected;
      expect(mocks.setData).not.toHaveBeenCalled();
      expect(mocks.close).toHaveBeenCalledOnce();
    }
  );

  it('cancelling does not register an account', async () => {
    const { pending, event } = await connect();
    event({ type: 'close' });
    expect(await pending).toBe('closed');
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'registers an account the Connect UI never reported (native=%s)',
    async (native) => {
      mocks.recover.mockResolvedValue(
        ok({ app_slug: 'linear', enabled: true })
      );
      const { pending, event } = await connect(native);
      event({ type: 'close' });
      expect(await pending).toBe('connected');
      expect(mocks.recover).toHaveBeenCalledExactlyOnceWith({
        app_slug: 'linear',
        server_name: 'Linear',
      });
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.invalidate).toHaveBeenCalledOnce();
    }
  );

  it('surfaces recovery failures other than a missing account', async () => {
    mocks.recover.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'boom' }])
    );
    const { pending, event } = await connect();
    const rejected = expect(pending).rejects.toThrow();
    event({ type: 'close' });
    await rejected;
    expect(mocks.setData).not.toHaveBeenCalled();
  });
});

describe('overlaid apps connect through their own MCP server', () => {
  const sentry = {
    app_slug: 'sentry',
    server_url: 'https://mcp.sentry.dev/mcp',
  };
  const authorized = {
    url: 'https://mcp.sentry.dev/mcp',
    server_name: 'Sentry',
    enabled: true,
    authenticated: true,
  };

  beforeEach(() => {
    mocks.cachedOverlays = [sentry];
    mocks.startAuth.mockResolvedValue(
      ok({ authorization_url: 'https://sentry.io/oauth/authorize?x=1' })
    );
  });

  it('authorizes the overlay server in the reserved tab, never Pipedream', async () => {
    const popup = { closed: false, close: vi.fn() };
    mocks.reservePopup.mockReturnValue(popup);
    mocks.fetchServers.mockResolvedValue([authorized]);

    const outcome = await connectPipedreamApp({
      appSlug: 'sentry',
      serverName: 'Sentry',
    });

    expect(outcome).toBe('connected');
    expect(mocks.startAuth).toHaveBeenCalledWith({
      server_url: 'https://mcp.sentry.dev/mcp',
      server_name: 'Sentry',
    });
    expect(mocks.assignUrl).toHaveBeenCalledWith(
      popup,
      'https://sentry.io/oauth/authorize?x=1'
    );
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('reports closed when the tab closes before the server is authorized', async () => {
    mocks.reservePopup.mockReturnValue({ closed: true, close: vi.fn() });
    mocks.fetchServers.mockResolvedValue([
      { ...authorized, authenticated: false },
    ]);

    expect(await connectPipedreamApp({ appSlug: 'sentry' })).toBe('closed');
  });

  it('looks the overlay up when it is not cached yet', async () => {
    mocks.cachedOverlays = undefined;
    mocks.overlays = [sentry];
    mocks.fetchServers.mockResolvedValue([authorized]);

    expect(await connectPipedreamApp({ appSlug: 'sentry' })).toBe('connected');
    expect(mocks.reservePopup).not.toHaveBeenCalled();
    expect(mocks.assignUrl).toHaveBeenCalledWith(
      null,
      'https://sentry.io/oauth/authorize?x=1'
    );
    expect(mocks.token).not.toHaveBeenCalled();
  });
});

describe('a backend without overlays', () => {
  it('connects through Pipedream when the overlay list cannot be read', async () => {
    mocks.overlaysUnavailable = true;
    const { pending, event } = await connect();
    event({ type: 'close' });
    expect(await pending).toBe('closed');
    expect(mocks.token).toHaveBeenCalledOnce();
  });
});

describe('overlaidAppSlug', () => {
  const overlays = [
    { app_slug: 'sentry', server_url: 'https://mcp.sentry.dev/mcp' },
  ];
  it('matches a connected server to its catalog app despite a trailing slash', () => {
    expect(overlaidAppSlug(overlays, 'https://mcp.sentry.dev/mcp/')).toBe(
      'sentry'
    );
  });
  it('leaves custom servers unmatched', () => {
    expect(
      overlaidAppSlug(overlays, 'https://example.com/mcp')
    ).toBeUndefined();
  });
});
