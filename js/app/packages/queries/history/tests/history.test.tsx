/**
 * @vitest-environment jsdom
 */

import { err, ok } from '@core/util/maybeResult';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { historyKeys } from '../keys';

// Mock all external dependencies first
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getUsersHistory: vi.fn(),
    trackOpenedDocument: vi.fn(),
    trackOpenedChat: vi.fn(),
    upsertItemToUserHistory: vi.fn(),
  },
}));

vi.mock('@service-storage/instructionsMd', () => ({
  useInstructionsMdIdQuery: () => ({
    isSuccess: false,
    data: null,
  }),
}));

vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name?: string }) => item.name ?? 'Untitled',
}));

import { storageServiceClient } from '@service-storage/client';
import {
  optimisticUpdateViewedAt,
  useTrackViewedMutation,
} from '../history';

const mockTrackOpenedDocument = vi.mocked(
  storageServiceClient.trackOpenedDocument
);
const mockTrackOpenedChat = vi.mocked(storageServiceClient.trackOpenedChat);
const mockUpsertItemToUserHistory = vi.mocked(
  storageServiceClient.upsertItemToUserHistory
);

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

type MockItem = {
  id: string;
  name: string;
  type: string;
  viewedAt?: number;
};

type HistoryQueryResponse = {
  data: MockItem[];
};

function createMockHistoryItem(
  overrides: Partial<MockItem> = {}
): MockItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    name: 'Test Document',
    type: 'document',
    viewedAt: undefined,
    ...overrides,
  };
}

function seedQueryCache(items: MockItem[]) {
  const queryKey = historyKeys.list.queryKey;
  testQueryClient.setQueryData(queryKey, { data: items });
  return queryKey;
}

function getHistoryFromCache(): MockItem[] {
  const queryKey = historyKeys.list.queryKey;
  const data = testQueryClient.getQueryData<HistoryQueryResponse>(queryKey);
  return data?.data ?? [];
}

function createWrapper() {
  return function Wrapper(props: { children: JSX.Element }) {
    return (
      <QueryClientProvider client={testQueryClient}>
        {props.children}
      </QueryClientProvider>
    );
  };
}

function renderWithClient(Component: () => JSX.Element): () => void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Wrapper = createWrapper();
  const dispose = render(
    () => (
      <Wrapper>
        <Component />
      </Wrapper>
    ),
    container
  );
  return () => {
    dispose();
    container.remove();
  };
}

describe('history mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  describe('useTrackViewedMutation', () => {
    it('should optimistically update viewedAt when tracking document open', async () => {
      const item1 = createMockHistoryItem({ id: 'doc-1', viewedAt: undefined });
      const item2 = createMockHistoryItem({ id: 'doc-2', viewedAt: undefined });
      seedQueryCache([item1, item2]);

      mockTrackOpenedDocument.mockResolvedValue(ok(undefined));

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useTrackViewedMutation();
        mutatePromise = mutation.mutateAsync({
          itemId: 'doc-1',
          itemType: 'document',
        });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      const items = getHistoryFromCache();
      expect(items[0].viewedAt).toBeDefined();
      expect(items[0].viewedAt).toBeGreaterThan(0);
      expect(items[1].viewedAt).toBeUndefined();

      cleanup();
    });

    it('should call trackOpenedChat for chat items', async () => {
      const item1 = createMockHistoryItem({
        id: 'chat-1',
        type: 'chat',
        viewedAt: undefined,
      });
      seedQueryCache([item1]);

      mockTrackOpenedChat.mockResolvedValue(ok(undefined));

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useTrackViewedMutation();
        mutatePromise = mutation.mutateAsync({
          itemId: 'chat-1',
          itemType: 'chat',
        });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      expect(mockTrackOpenedChat).toHaveBeenCalledWith({ chatId: 'chat-1' });

      cleanup();
    });

    it('should call upsertItemToUserHistory for other item types', async () => {
      const item1 = createMockHistoryItem({
        id: 'project-1',
        type: 'project',
        viewedAt: undefined,
      });
      seedQueryCache([item1]);

      mockUpsertItemToUserHistory.mockResolvedValue(ok(undefined));

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useTrackViewedMutation();
        mutatePromise = mutation.mutateAsync({
          itemId: 'project-1',
          itemType: 'project',
        });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      expect(mockUpsertItemToUserHistory).toHaveBeenCalledWith({
        itemId: 'project-1',
        itemType: 'project',
      });

      cleanup();
    });

    it('should rollback optimistic update on error', async () => {
      const item1 = createMockHistoryItem({ id: 'doc-1', viewedAt: undefined });
      seedQueryCache([item1]);

      mockTrackOpenedDocument.mockResolvedValue(
        err('SERVER_ERROR', 'Failed to track')
      );

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useTrackViewedMutation();
        mutatePromise = mutation
          .mutateAsync({ itemId: 'doc-1', itemType: 'document' })
          .catch(() => {});
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;
      // Wait for rollback to complete
      await new Promise((r) => setTimeout(r, 10));

      const items = getHistoryFromCache();
      expect(items[0].viewedAt).toBeUndefined();

      cleanup();
    });
  });

  describe('optimisticUpdateViewedAt', () => {
    it('should update viewedAt for matching item', () => {
      const item1 = createMockHistoryItem({ id: 'doc-1', viewedAt: undefined });
      const item2 = createMockHistoryItem({ id: 'doc-2', viewedAt: undefined });
      seedQueryCache([item1, item2]);

      optimisticUpdateViewedAt('doc-1');

      const items = getHistoryFromCache();
      expect(items[0].viewedAt).toBeDefined();
      expect(items[0].viewedAt).toBeGreaterThan(0);
      expect(items[1].viewedAt).toBeUndefined();
    });

    it('should not modify items with different id', () => {
      const item1 = createMockHistoryItem({
        id: 'doc-1',
        viewedAt: 1000,
      });
      const item2 = createMockHistoryItem({
        id: 'doc-2',
        viewedAt: 2000,
      });
      seedQueryCache([item1, item2]);

      optimisticUpdateViewedAt('doc-3');

      const items = getHistoryFromCache();
      expect(items[0].viewedAt).toBe(1000);
      expect(items[1].viewedAt).toBe(2000);
    });

    it('should handle empty cache gracefully', () => {
      // Don't seed any data
      expect(() => optimisticUpdateViewedAt('doc-1')).not.toThrow();
    });
  });
});
