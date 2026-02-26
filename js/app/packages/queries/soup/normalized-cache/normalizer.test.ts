import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

const mockCreateQueryNormalizer = vi.fn(() => ({
  subscribe: mockSubscribe,
  unsubscribe: mockUnsubscribe,
  setNormalizedData: vi.fn(),
  getObjectById: vi.fn(),
  getQueryFragment: vi.fn(),
  getDependentQueries: vi.fn(() => []),
  getDependentQueriesByIds: vi.fn(() => []),
  getNormalizedData: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@normy/query-core', () => ({
  createQueryNormalizer: mockCreateQueryNormalizer,
}));

describe('initSoupNormalizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates normalizer in opt-in mode and subscribes once', async () => {
    const { initSoupNormalizer, getNormalizationObjectKey } = await import(
      './normalizer'
    );

    const queryClient = {} as Parameters<typeof initSoupNormalizer>[0];
    const cleanup = initSoupNormalizer(queryClient);

    expect(mockCreateQueryNormalizer).toHaveBeenCalledWith(queryClient, {
      getNormalizationObjectKey,
      normalize: false,
    });
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    cleanup();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
