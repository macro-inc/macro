import type { openPipedreamConnectUI } from '@core/pipedream/connect-ui';
import type { Connector } from '@service-cognition/generated/schemas';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: false,
  userId: 'user-one',
  start: vi.fn(),
  complete: vi.fn(),
  open: vi.fn(),
  openNative: vi.fn(),
  closeDialog: vi.fn(),
  closeTab: vi.fn(),
  reservePopup: vi.fn(),
  assignUrl: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(async () => {}),
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
    getQueryData: () => ({ id: mocks.userId }),
  },
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {
    startConnectorConnect: mocks.start,
    completeConnectorConnect: mocks.complete,
  },
}));

import { connectConnector } from './connect';

const NOT_FOUND = err([{ code: 'NOT_FOUND', message: 'Resource not found' }]);

function connector(key: string, status: Connector['status'] = 'connected') {
  return ok<Connector>({
    key,
    target: { type: 'app', slug: key.slice('app/'.length) },
    name: 'Linear',
    status,
    connectable: true,
    mcp: true,
    api: true,
    importAvailable: false,
  });
}

const DIALOG = {
  type: 'embeddedDialog' as const,
  token: 'ctok_fixture',
  expiresAt: '2026-11-22T00:00:00Z',
  link: 'https://connect.example/connect?token=ctok_fixture&app=slack_v2',
};

type DialogOptions = Parameters<typeof openPipedreamConnectUI>[0];

/** Start connecting and wait for the embedded dialog to open. */
async function openDialog(key: string) {
  mocks.start.mockResolvedValue(ok(DIALOG));
  const opened = Promise.withResolvers<DialogOptions>();
  const open = mocks.native ? mocks.openNative : mocks.open;
  open.mockImplementation((options: DialogOptions) => {
    opened.resolve(options);
    return { close: mocks.closeDialog };
  });
  const pending = connectConnector({ key });
  return { pending, options: await opened.promise };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.native = false;
  mocks.userId = 'user-one';
  mocks.complete.mockResolvedValue(NOT_FOUND);
  mocks.reservePopup.mockReturnValue({ closed: false, close: mocks.closeTab });
});

describe('connecting through an embedded dialog', () => {
  it("opens the server's dialog for the app its link names, then records the connection", async () => {
    mocks.complete.mockResolvedValue(connector('app/slack'));
    const { pending, options } = await openDialog('app/slack');
    expect(mocks.start).toHaveBeenCalledWith({ key: 'app/slack' });
    expect(options).toMatchObject({ token: 'ctok_fixture', app: 'slack_v2' });
    // The tab reserved in the click is not needed for a dialog.
    expect(mocks.closeTab).toHaveBeenCalledOnce();
    expect(mocks.assignUrl).not.toHaveBeenCalled();
    options.onEvent({ type: 'success', accountId: 'apn_fixture' });
    expect(await pending).toBe('connected');
    expect(mocks.complete).toHaveBeenCalledWith({ key: 'app/slack' });
    expect(mocks.setData).toHaveBeenCalledOnce();
    expect(mocks.closeDialog).toHaveBeenCalled();
  });

  it('uses the system browser in the native apps', async () => {
    mocks.native = true;
    mocks.complete.mockResolvedValue(connector('app/linear'));
    const { pending, options } = await openDialog('app/linear');
    expect(mocks.open).not.toHaveBeenCalled();
    options.onEvent({ type: 'success', accountId: 'apn_fixture' });
    expect(await pending).toBe('connected');
  });

  it('asks the server once when the dialog closes without reporting success', async () => {
    const { pending, options } = await openDialog('app/linear');
    options.onEvent({ type: 'close' });
    expect(await pending).toBe('closed');
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.setData).not.toHaveBeenCalled();
  });

  it('records a connection the dialog made but never reported', async () => {
    mocks.complete.mockResolvedValue(connector('app/linear'));
    const { pending, options } = await openDialog('app/linear');
    options.onEvent({ type: 'close' });
    expect(await pending).toBe('connected');
  });

  it('keeps errors inside the dialog, where the user can retry', async () => {
    mocks.complete.mockResolvedValue(connector('app/linear'));
    const { pending, options } = await openDialog('app/linear');
    options.onEvent({ type: 'error', error: 'bad key' });
    expect(mocks.complete).not.toHaveBeenCalled();
    options.onEvent({ type: 'success', accountId: 'apn_fixture' });
    expect(await pending).toBe('connected');
  });

  it('does not record a connection after the user changes accounts', async () => {
    mocks.complete.mockResolvedValue(connector('app/linear'));
    const { pending, options } = await openDialog('app/linear');
    mocks.userId = 'user-two';
    options.onEvent({ type: 'success', accountId: 'apn_fixture' });
    expect(await pending).toBe('closed');
    expect(mocks.setData).not.toHaveBeenCalled();
  });

  it('fails when the recorded connection is not usable', async () => {
    mocks.complete.mockResolvedValue(connector('app/linear', 'notConnected'));
    const { pending, options } = await openDialog('app/linear');
    options.onEvent({ type: 'success', accountId: 'apn_fixture' });
    await expect(pending).rejects.toThrow();
  });
});

describe('connecting on a page', () => {
  it('opens the page in the tab reserved in the click and polls until the connection exists', async () => {
    vi.useFakeTimers();
    const tab = {
      closed: false,
      close: mocks.closeTab,
      location: { href: '' },
    };
    mocks.reservePopup.mockReturnValue(tab);
    mocks.start.mockResolvedValue(
      ok({ type: 'openUrl', url: 'https://consent.example/linear' })
    );
    mocks.complete
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(connector('app/linear'));
    const pending = connectConnector({ key: 'app/linear' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe('connected');
    expect(mocks.assignUrl).toHaveBeenCalledWith(
      tab,
      'https://consent.example/linear'
    );
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.reservePopup).toHaveBeenCalledOnce();
    expect(mocks.closeTab).not.toHaveBeenCalled();
  });

  it.each(['app/linear', 'server/aHR0cHM6Ly94'])(
    'reserves the tab inside the click for %s, before the server answers',
    (key) => {
      mocks.start.mockReturnValue(new Promise(() => {}));
      // The server never answers here: Safari only allows a tab opened in the
      // click, so it must already be open.
      expect(connectConnector({ key })).toBeInstanceOf(Promise);
      expect(mocks.reservePopup).toHaveBeenCalledOnce();
    }
  );

  it('stops when the user closes the page without connecting', async () => {
    mocks.reservePopup.mockReturnValue({ closed: true });
    mocks.start.mockResolvedValue(
      ok({ type: 'openUrl', url: 'https://consent.example/linear' })
    );
    expect(await connectConnector({ key: 'app/linear' })).toBe('closed');
    expect(mocks.complete).toHaveBeenCalledOnce();
  });

  it.each(['app/linear', 'server/aHR0cHM6Ly94'])(
    'closes the reserved tab when the server refuses %s',
    async (key) => {
      mocks.start.mockResolvedValue(
        err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
      );
      await expect(connectConnector({ key })).rejects.toThrow();
      expect(mocks.closeTab).toHaveBeenCalled();
      expect(mocks.assignUrl).not.toHaveBeenCalled();
    }
  );

  it('closes the reserved tab when another user signs in meanwhile', async () => {
    mocks.start.mockImplementation(async () => {
      mocks.userId = 'user-two';
      return ok({ type: 'openUrl', url: 'https://consent.example/linear' });
    });
    expect(await connectConnector({ key: 'app/linear' })).toBe('closed');
    expect(mocks.closeTab).toHaveBeenCalledOnce();
    expect(mocks.assignUrl).not.toHaveBeenCalled();
  });
});

describe('polling a page that cannot report back', () => {
  const tab = { closed: false, close: vi.fn(), location: { href: '' } };
  const blip = err([{ code: 'NETWORK_ERROR', message: 'Failed to fetch' }]);
  const linear = connector('app/linear');

  beforeEach(() => {
    vi.useFakeTimers();
    tab.closed = false;
    tab.location.href = '';
    mocks.reservePopup.mockReturnValue(tab);
    mocks.start.mockResolvedValue(
      ok({ type: 'openUrl', url: 'https://consent.example/linear' })
    );
  });

  it('sends the tab to the page that closes itself once connected', async () => {
    mocks.complete.mockResolvedValueOnce(linear);
    const pending = connectConnector({ key: 'app/linear' });
    await vi.runAllTimersAsync();
    expect(await pending).toBe('connected');
    expect(tab.location.href).toContain(
      '/pipedream/mcp/connect/callback?status=connected'
    );
  });

  it('keeps polling through a failed poll', async () => {
    mocks.complete
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(blip)
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(linear);
    const pending = connectConnector({ key: 'app/linear' });
    await vi.runAllTimersAsync();
    expect(await pending).toBe('connected');
    expect(mocks.complete).toHaveBeenCalledTimes(4);
  });

  it('still records the connection when the poll after the tab closes fails', async () => {
    tab.closed = true;
    mocks.complete.mockResolvedValueOnce(blip).mockResolvedValueOnce(linear);
    const pending = connectConnector({ key: 'app/linear' });
    await vi.runAllTimersAsync();
    expect(await pending).toBe('connected');
  });

  it('fails and retires the tab when polls fail until the deadline', async () => {
    mocks.complete.mockResolvedValue(blip);
    const pending = connectConnector({ key: 'app/linear' });
    const outcome = expect(pending).rejects.toBeDefined();
    await vi.runAllTimersAsync();
    await outcome;
    expect(tab.location.href).toContain(
      '/pipedream/mcp/connect/callback?status=error'
    );
    expect(mocks.setData).not.toHaveBeenCalled();
  });

  it('retires a tab still open at the deadline', async () => {
    const pending = connectConnector({ key: 'app/linear' });
    await vi.runAllTimersAsync();
    expect(await pending).toBe('closed');
    expect(tab.location.href).toContain(
      '/pipedream/mcp/connect/callback?status=error'
    );
  });
});

describe('connecting GitHub', () => {
  it('asks the server like any app and opens the page it answers', async () => {
    // A flagged user's GitHub goes through Connect's consent page, and the
    // account link through the app's own page: the server picks.
    const tab = { closed: true, close: mocks.closeTab };
    mocks.reservePopup.mockReturnValue(tab);
    mocks.start.mockResolvedValue(
      ok({ type: 'openUrl', url: 'https://app.example/app/connect/github' })
    );
    expect(await connectConnector({ key: 'app/github' })).toBe('closed');
    expect(mocks.start).toHaveBeenCalledWith({ key: 'app/github' });
    expect(mocks.assignUrl).toHaveBeenCalledWith(
      tab,
      'https://app.example/app/connect/github'
    );
  });
});
