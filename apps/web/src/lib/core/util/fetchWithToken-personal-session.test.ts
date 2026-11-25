import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  accessToken: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', async (original) => ({
  ...(await original<typeof import('@core/constant/featureFlags')>()),
  ENABLE_BEARER_TOKEN_AUTH: true,
}));
vi.mock('@service-auth/fetch', () => ({
  fetchWithAuth: auth.apiRequest,
  getPersonalAccessToken: auth.accessToken,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('sends the user session credential when IMAP linking runs in bearer mode', async () => {
  const { emailClient } = await import('@service-email/client');
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ linkId: 'inbox' }));
  vi.stubGlobal('fetch', request);
  auth.accessToken.mockResolvedValue('synthetic-personal-session');
  auth.apiRequest.mockResolvedValue(ok({ linkId: 'unexpected-sdk-request' }));
  const login = {
    endpoint: {
      host: 'mail.example.net',
      port: 993,
      tls: 'implicit' as const,
      username: 'owner@example.net',
    },
    password: 'fixture-only-secret',
  };

  const result = await emailClient.imapConnect(
    {
      requestId: '00000000-0000-4000-8000-000000000001',
      imap: login,
      smtp: login,
      confirmedHosts: [login.endpoint.host],
    },
    new AbortController().signal
  );

  expect(result._unsafeUnwrap()).toEqual({ linkId: 'inbox' });
  expect(auth.apiRequest).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1]?.credentials).toBe('omit');
  const headers = new Headers(request.mock.calls[0][1]?.headers);
  expect(headers.get('authorization')).toBe(
    'Bearer synthetic-personal-session'
  );
});

it('does not send a personal-session request cancelled while refreshing the token', async () => {
  const { fetchWithToken } = await import('./fetchWithToken');
  const refresh = Promise.withResolvers<string>();
  auth.accessToken.mockReturnValue(refresh.promise);
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  const controller = new AbortController();

  const response = fetchWithToken('/email/links/imap', {
    method: 'POST',
    personalSession: true,
    signal: controller.signal,
  });
  controller.abort();
  refresh.resolve('synthetic-personal-session');

  expect((await response)._unsafeUnwrapErr()).toMatchObject([
    { name: 'AbortError', code: 'NETWORK_ERROR' },
  ]);
  expect(auth.apiRequest).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
