import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { resolveScreenUrl } from './screen-url';

const auth = vi.hoisted(() => ({
  bearer: false,
  token: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'agent-harness': 'https://example.test/harness-service' },
}));
vi.mock('@core/constant/featureFlags', () => ({
  get ENABLE_BEARER_TOKEN_AUTH() {
    return auth.bearer;
  },
}));
vi.mock('@core/util/fetchWithToken', () => ({
  ensureFreshSession: auth.refresh,
}));
vi.mock('@service-auth/fetch', () => ({ getMacroApiToken: auth.token }));
beforeEach(() => {
  vi.clearAllMocks();
  auth.bearer = false;
  auth.refresh.mockResolvedValue(ok(undefined));
});

it('refreshes browser cookies and watches without requesting control', async () => {
  const url = new URL(await resolveScreenUrl('computer', false));
  expect(url.protocol).toBe('wss:');
  expect(url.pathname).toBe('/harness-service/harnesses/computer/screen');
  expect(url.searchParams.has('control')).toBe(false);
  expect(url.searchParams.has('macro-api-token')).toBe(false);
  expect(auth.refresh).toHaveBeenCalledTimes(1);
  expect(auth.token).not.toHaveBeenCalled();
});

it('resolves a fresh bearer token on each control connection', async () => {
  auth.bearer = true;
  auth.token.mockResolvedValueOnce('first+/=').mockResolvedValueOnce('second');
  const first = new URL(await resolveScreenUrl('computer', true));
  const second = new URL(await resolveScreenUrl('computer', false));
  expect(first.searchParams.get('control')).toBe('true');
  expect(first.searchParams.get('macro-api-token')).toBe('first+/=');
  expect(second.searchParams.get('macro-api-token')).toBe('second');
  expect(second.searchParams.has('control')).toBe(false);
  expect(auth.refresh).not.toHaveBeenCalled();
});

it('does not attempt a socket after cookie refresh fails', async () => {
  auth.refresh.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));
  await expect(resolveScreenUrl('computer', true)).rejects.toThrow(
    'Unable to refresh screen session'
  );
});
