import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  complete: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(async () => {}),
}));
vi.mock('@core/pipedream/connect-ui', () => ({
  openPipedreamConnectUI: mocks.open,
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    setQueryData: mocks.setData,
    invalidateQueries: mocks.invalidate,
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
  mocks.open.mockImplementation(() => ({ close: mocks.close }));
});

async function connect() {
  const pending = connectPipedreamApp({ appSlug: 'linear' });
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
  const event = mocks.open.mock.calls[0][0].onEvent;
  return { pending, event };
}

describe('verified Pipedream connection completion', () => {
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
