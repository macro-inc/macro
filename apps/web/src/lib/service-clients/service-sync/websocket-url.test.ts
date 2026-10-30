import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  bearer: false,
  token: vi.fn(async () => 'token+/='),
  cookie: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  get ENABLE_BEARER_TOKEN_AUTH() {
    return auth.bearer;
  },
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'document-storage-service': 'https://gateway.test/dss' },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchToken: auth.cookie }));
vi.mock('@service-auth/fetch', () => ({ getMacroApiToken: auth.token }));

import { resolveSyncRouterWsUrl } from './websocket-url';

beforeEach(() => {
  vi.clearAllMocks();
  auth.bearer = false;
  auth.cookie.mockResolvedValue(ok(undefined));
});

describe('dedicated DSS sync socket credentials', () => {
  it('preserves the DSS gateway prefix and refreshes cookies on each connection', async () => {
    expect(await resolveSyncRouterWsUrl()).toBe(
      'wss://gateway.test/dss/sync/ws'
    );
    await resolveSyncRouterWsUrl();
    expect(auth.cookie).toHaveBeenCalledTimes(2);
    expect(auth.token).not.toHaveBeenCalled();
  });

  it('encodes a fresh bearer token in the upgrade query', async () => {
    auth.bearer = true;
    const url = new URL(await resolveSyncRouterWsUrl());
    expect(url.pathname).toBe('/dss/sync/ws');
    expect(url.searchParams.get('macro-api-token')).toBe('token+/=');
    expect(auth.cookie).not.toHaveBeenCalled();
  });

  it('does not connect after a failed cookie refresh', async () => {
    auth.cookie.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));
    await expect(resolveSyncRouterWsUrl()).rejects.toThrow(
      'Unable to refresh sync session'
    );
  });
});
