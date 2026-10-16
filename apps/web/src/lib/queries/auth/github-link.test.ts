import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchGithubLinkStatus } from './github-link';

const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { checkGithubLinkStatus: mocks.check },
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
it('only treats a confirmed missing account as unlinked', async () => {
  mocks.check.mockResolvedValue(err([{ code: 'NOT_FOUND' }]));
  expect(await fetchGithubLinkStatus()).toEqual({ status: 'unlinked' });
});
it.each(['SERVER_ERROR', 'UNAUTHORIZED', 'NETWORK_ERROR'])(
  'preserves %s as a failure instead of asking for OAuth',
  async (code) => {
    mocks.check.mockResolvedValue(err([{ code }]));
    await expect(fetchGithubLinkStatus()).rejects.toBeDefined();
  }
);
it('preserves explicit reauthorization and linked states', async () => {
  mocks.check.mockResolvedValue(err([{ code: 'REAUTHENTICATION_REQUIRED' }]));
  expect(await fetchGithubLinkStatus()).toEqual({
    status: 'reauthentication_required',
  });
  mocks.check.mockResolvedValue(ok({ reauthentication_required: false }));
  expect((await fetchGithubLinkStatus()).status).toBe('linked');
});
