import type { openPipedreamConnectUI } from '@core/pipedream/connect-ui';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  complete: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(async () => {}),
  native: false,
  openNative: vi.fn(),
  userId: 'user-one',
}));
vi.mock('@core/util/platform', () => ({ isTauri: () => mocks.native }));
vi.mock('@core/pipedream/connect-native', () => ({
  openNativePipedreamConnectUI: mocks.openNative,
}));
vi.mock('@core/pipedream/connect-ui', () => ({
  openPipedreamConnectUI: mocks.open,
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    setQueryData: mocks.setData,
    invalidateQueries: mocks.invalidate,
    getQueryData: () => ({ id: mocks.userId }),
  },
}));
vi.mock('@service-cognition/client', () => ({
  PIPEDREAM_DISABLED: 'PIPEDREAM_DISABLED',
  cognitionApiServiceClient: {
    createPipedreamToken: async () => ok({ token: 'fixture' }),
    completePipedreamConnection: mocks.complete,
  },
}));

import { connectPipedreamApp } from './pipedream-connectors';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = false;
  mocks.userId = 'user-one';
  mocks.open.mockImplementation(() => ({ close: mocks.close }));
  mocks.openNative.mockImplementation(() => ({ close: mocks.close }));
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
});
