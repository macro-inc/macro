import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const soup = vi.hoisted(() => ({
  args: undefined as (() => { params: { limit?: number } }) | undefined,
  options: undefined as
    | (() => { enabled?: boolean; graphqlCacheFirstEntities?: unknown })
    | undefined,
  query: { isPending: false, data: { entities: [] as unknown[] } },
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: (
    args: typeof soup.args,
    options: typeof soup.options
  ) => {
    soup.args = args;
    soup.options = options;
    return soup.query;
  },
}));

import { useFeaturedDocuments } from './featured-documents';

afterEach(() => vi.useRealTimers());

it('reads the featured documents once typing settles, cache first', () => {
  vi.useFakeTimers();
  const [ids, setIds] = createSignal<string[]>([]);
  const { documents, dispose } = createRoot((dispose) => ({
    dispose,
    documents: useFeaturedDocuments(ids),
  }));
  expect(soup.options?.().enabled).toBe(false);
  expect(documents()).toEqual([]);

  soup.query.data = { entities: [{ id: 'task-1' }] };
  setIds(['task-2', 'task-1', 'task-1']);
  vi.advanceTimersByTime(100);
  expect(soup.options?.().enabled).toBe(false);
  expect(documents()).toEqual([]);

  vi.advanceTimersByTime(50);
  expect(soup.options?.()).toMatchObject({
    enabled: true,
    graphqlCacheFirstEntities: [
      { entityType: 'DOCUMENT', entityId: 'task-1' },
      { entityType: 'DOCUMENT', entityId: 'task-2' },
    ],
  });
  expect(soup.args?.().params.limit).toBe(2);
  expect(documents()).toEqual([{ id: 'task-1' }]);
  dispose();
});
