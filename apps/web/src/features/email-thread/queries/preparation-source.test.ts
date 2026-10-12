import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readThreadForPreparation } from './preparation-source';

const mocks = vi.hoisted(() => ({
  cached: vi.fn(),
  fetch: vi.fn(),
  retain: vi.fn(),
  release: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => true,
}));
vi.mock('@queries/email/thread', () => ({
  readCachedEmailThread: mocks.cached,
  fetchAndCacheThread: mocks.fetch,
}));
vi.mock('@queries/email/graphql/preload', () => ({
  retainGraphqlEmailThread: mocks.retain,
}));
vi.mock('./thread-source', () => ({
  toEmailThread: (thread: unknown) => thread,
}));

describe('preparation source retention', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.retain.mockReturnValue({
      release: mocks.release,
      ready: Promise.resolve(undefined),
    });
  });
  it('retains an available cached page without waiting for another cache read', async () => {
    const source = { thread: { messages: [] }, hasMore: true };
    mocks.cached.mockResolvedValue(source);
    const retain = vi.fn();
    expect(await readThreadForPreparation('thread', false, retain)).toEqual(
      source
    );
    expect(mocks.retain).toHaveBeenCalledWith('thread', true);
    expect(retain).toHaveBeenCalledWith(mocks.release);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('waits for the existing network prefetch before retaining a cold source', async () => {
    mocks.cached.mockResolvedValue(undefined);
    const network = Promise.withResolvers<unknown>();
    mocks.fetch.mockReturnValue(network.promise);
    const request = readThreadForPreparation('thread', false, vi.fn());
    await Promise.resolve();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.retain).not.toHaveBeenCalled();
    network.resolve({
      isErr: () => false,
      value: { thread: { messages: [] } },
    });
    expect(await request).toEqual({ thread: { messages: [] }, hasMore: false });
    expect(mocks.retain).toHaveBeenCalledWith('thread', true);
  });
  it('keeps hydration misses local and leaves failed requests retryable', async () => {
    mocks.cached.mockResolvedValue(undefined);
    expect(
      await readThreadForPreparation('thread', true, vi.fn())
    ).toBeUndefined();
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue({ isErr: () => true });
    expect(
      await readThreadForPreparation('thread', false, vi.fn())
    ).toBeUndefined();
    expect(mocks.retain).not.toHaveBeenCalled();
  });
});
