import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeCachedEmailThread } from './cached-access';

const mocks = vi.hoisted(() => ({
  removeQueries: vi.fn(),
  deleteRecords: vi.fn(async (_keys: string[]) => {}),
  renders: vi.fn(async () => {}),
}));
vi.mock('../client', () => ({
  queryClient: { removeQueries: mocks.removeQueries },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => ({ deleteRecords: mocks.deleteRecords }),
}));
vi.mock('@app/lib/email-render-cache/lifecycle', () => ({
  invalidateEmailRenders: mocks.renders,
}));

describe('authoritative thread access revocation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('waits for durable source deletion before allowing a new render-cache generation', async () => {
    const pending = Promise.withResolvers<void>();
    mocks.deleteRecords.mockReturnValueOnce(pending.promise);
    const clearing = revokeCachedEmailThread('denied');
    expect(mocks.removeQueries).toHaveBeenCalledWith({
      queryKey: ['email', 'threadMessages', 'messages', 'denied'],
    });
    expect(mocks.deleteRecords).toHaveBeenCalledWith([
      'GraphqlSoupEmailThread:denied',
    ]);
    expect(mocks.renders).not.toHaveBeenCalled();
    pending.resolve();
    await clearing;
    expect(mocks.renders).toHaveBeenCalledOnce();
  });
  it('still releases derived data when the source cache is unavailable', async () => {
    mocks.deleteRecords.mockRejectedValueOnce(new Error('cache unavailable'));
    await revokeCachedEmailThread('denied');
    expect(mocks.renders).toHaveBeenCalledOnce();
  });
});
