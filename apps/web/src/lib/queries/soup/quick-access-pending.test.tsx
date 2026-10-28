import { render, screen, waitFor } from '@solidjs/testing-library';
import {
  createQuery,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { createRoot, createSignal, Suspense } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: undefined as unknown }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@entity', () => ({
  isSnippetEntity: (entity: { type: string }) => entity.type === 'snippet',
  isSkillEntity: (entity: { type: string }) => entity.type === 'skill',
}));
vi.mock('@queries/soup/items', () => ({
  useSoupItemsQuery: () => mocks.query,
}));

import { useQuickAccessSkillsQuery } from './quick-access-skills';
import { useQuickAccessSnippetsQuery } from './quick-access-snippets';

const feeds = [
  {
    type: 'snippet',
    useEntities: () => useQuickAccessSnippetsQuery().snippets,
  },
  { type: 'skill', useEntities: () => useQuickAccessSkillsQuery().skills },
];

describe.each(feeds)('Quick Access $type', ({ type, useEntities }) => {
  it('does not read pending query data, including disabled or paused queries', () => {
    createRoot((dispose) => {
      const [pending, setPending] = createSignal(true);
      const entity = { id: 'one', type };
      mocks.query = {
        isLoading: false,
        get isPending() {
          return pending();
        },
        get data() {
          if (pending()) throw new Error('Pending query data was read');
          return [entity];
        },
      };

      try {
        const entities = useEntities();
        expect(entities()).toEqual([]);

        setPending(false);
        expect(entities()).toEqual([entity]);
      } finally {
        dispose();
      }
    });
  });

  it('does not suspend the app shell while the discovery request is pending', async () => {
    const response =
      Promise.withResolvers<Array<{ id: string; type: string }>>();
    const client = new QueryClient();
    function Shell() {
      mocks.query = createQuery(() => ({
        queryKey: ['quick-access', type],
        queryFn: () => response.promise,
        retry: false,
      }));
      const entities = useEntities();
      return <button>Navigation: {entities().length}</button>;
    }
    const view = render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<p>Loading app shell</p>}>
          <Shell />
        </Suspense>
      </QueryClientProvider>
    ));
    try {
      await waitFor(() => {
        expect(screen.getByRole('button').textContent).toBe('Navigation: 0');
        expect(screen.queryByText('Loading app shell')).toBeNull();
      });
      response.resolve([{ id: 'one', type }]);
      await waitFor(() =>
        expect(screen.getByRole('button').textContent).toBe('Navigation: 1')
      );
    } finally {
      response.resolve([]);
      view.unmount();
      client.clear();
    }
  });
});
