import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createPersonList } from './person-list';

const window = vi.hoisted(() => ({
  key: 'first',
  loadNext: vi.fn<() => Promise<void>>(),
}));
vi.mock('@queries/contacts/directory-query', () => ({
  createContactDirectoryWindow: () => ({
    inputKey: () => window.key,
    data: () => ({
      users: [],
      nextCursor: {
        source: 'server',
        userId: 'viewer',
        query: '',
        after: 'more',
      },
    }),
    windowKey: () => 'page',
    loading: () => false,
    error: () => null,
    loadNext: window.loadNext,
  }),
}));
beforeEach(() => {
  window.key = 'first';
  window.loadNext.mockReset();
  window.loadNext.mockResolvedValue(undefined);
});

it('does not keep advancing an empty window after its scope or eligibility changes', async () => {
  await createRoot(async (dispose) => {
    try {
      const release = Promise.withResolvers<void>();
      window.loadNext.mockReturnValueOnce(release.promise);
      const list = createPersonList({
        scope: () => ({ userId: 'viewer' }),
        search: () => '',
        enabled: () => true,
        policy: () => ({ mode: 'property', excluded: [] }),
        activity: () => new Map(),
        conversation: () => undefined,
        excluded: () => false,
      });
      const loading = list.loadMore();
      expect(window.loadNext).toHaveBeenCalledOnce();
      window.key = 'new-eligibility-or-generation';
      release.resolve();
      await loading;
      expect(window.loadNext).toHaveBeenCalledOnce();
      expect(list.isLoadingMore()).toBe(false);
    } finally {
      dispose();
    }
  });
});

it('still limits an explicit pagination action to four empty windows', async () => {
  await createRoot(async (dispose) => {
    try {
      const list = createPersonList({
        scope: () => ({ userId: 'viewer' }),
        search: () => '',
        enabled: () => true,
        policy: () => ({ mode: 'property', excluded: [] }),
        activity: () => new Map(),
        conversation: () => undefined,
        excluded: () => false,
      });
      await list.loadMore();
      expect(window.loadNext).toHaveBeenCalledTimes(4);
      expect(list.hasMore()).toBe(true);
    } finally {
      dispose();
    }
  });
});
