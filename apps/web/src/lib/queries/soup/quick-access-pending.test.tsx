import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: undefined as unknown }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@entity', () => ({
  isSnippetEntity: (entity: { type: string }) => entity.type === 'snippet',
}));
vi.mock('@queries/soup/items', () => ({
  useSoupItemsQuery: () => mocks.query,
}));

import { useQuickAccessSnippetsQuery } from './quick-access-snippets';

describe('Quick Access snippets', () => {
  it('does not read pending query data', () => {
    createRoot((dispose) => {
      const [pending, setPending] = createSignal(true);
      const entity = { id: 'one', type: 'snippet' };
      mocks.query = {
        get isPending() {
          return pending();
        },
        get data() {
          if (pending()) throw new Error('Pending query data was read');
          return [entity];
        },
      };

      const { snippets } = useQuickAccessSnippetsQuery();
      expect(snippets()).toEqual([]);

      setPending(false);
      expect(snippets()).toEqual([entity]);
      dispose();
    });
  });
});
