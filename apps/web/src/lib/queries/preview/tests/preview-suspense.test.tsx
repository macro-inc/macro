import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewKeys } from '../keys';
import type { PreviewItem } from '../types';

const fixture = vi.hoisted(() => ({ graphqlEnabled: true }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: fixture.graphqlEnabled }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => fixture.graphqlEnabled,
  LOCAL_ONLY: false,
}));
vi.mock('@service-storage/client', () => ({ DEFAULT_ITEM_TYPE: 'document' }));
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('../dataloader', () => ({ previewDataLoader: { load: vi.fn() } }));
vi.mock('../fetchers', () => ({
  defaultNameTransform: (item: PreviewItem) => item,
  fetchMessageContext: vi.fn(),
  fetchRestPreviewBatch: vi.fn(),
}));
vi.mock('../graphql', () => ({
  createGraphqlItemPreviewQuery: () => ({
    data: () => preview,
    isLoading: () => false,
    shouldFallback: () => false,
    refetch: vi.fn(),
  }),
  isGraphqlPreviewItem: () => true,
}));

import { useItemPreview } from '../preview';

const preview = {
  id: 'document-1',
  type: 'document',
  loading: false,
  access: 'access',
  name: 'Favorite document',
  rawName: 'Favorite document',
} satisfies PreviewItem;

let testQueryClient: QueryClient;
let dispose: (() => void) | undefined;

beforeEach(() => {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  testQueryClient.setQueryData(previewKeys.item(preview.id).queryKey, preview);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
  document.body.replaceChildren();
});

describe('preview disclosure mounting', () => {
  it.each([true, false])(
    'keeps the surrounding header attached on every reopen (GraphQL: %s)',
    async (graphqlEnabled) => {
      fixture.graphqlEnabled = graphqlEnabled;
      const [open, setOpen] = createSignal(false);

      function PreviewRow() {
        const [item] = useItemPreview(() => ({
          id: preview.id,
          type: 'document',
        }));
        return <span data-testid="row">{item().id}</span>;
      }

      dispose = render(
        () => (
          <QueryClientProvider client={testQueryClient}>
            <Suspense fallback={<span data-testid="suspended" />}>
              <button data-testid="header">Favorites</button>
              <Show when={open()}>
                <PreviewRow />
              </Show>
            </Suspense>
          </QueryClientProvider>
        ),
        document.body
      );
      const header = document.querySelector('[data-testid="header"]');
      expect(header).not.toBeNull();

      for (let attempt = 0; attempt < 2; attempt++) {
        setOpen(true);
        // Check before the disabled query's resource settles in a microtask.
        expect(document.querySelector('[data-testid="suspended"]')).toBeNull();
        expect(document.querySelector('[data-testid="header"]')).toBe(header);
        expect(document.querySelector('[data-testid="row"]')).not.toBeNull();
        await Promise.resolve();
        setOpen(false);
        expect(document.querySelector('[data-testid="row"]')).toBeNull();
      }
    }
  );
});
