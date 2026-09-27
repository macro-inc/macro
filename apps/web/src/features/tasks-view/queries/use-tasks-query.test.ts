import type { TaskEntityWithProperties } from '@entity/types/entity';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/collection/transforms')),
  useSearchContext: () => ({ entityPool: () => [] }),
  createSearchState: () => ({
    isSearching: () => false,
    usesServiceSearch: () => false,
    isSettling: () => false,
  }),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/task-properties')),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notificationsByEntity: () => ({}) }),
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => fixture.query,
}));
vi.mock('@queries/soup/grouped/create-grouped-soup-queries', () => ({
  createGroupedSoupQueries: () => ({ map: () => new Map() }),
}));

import { useTasksDataSource } from './use-tasks-query';

it('reports loading while a membership change hides placeholder rows', () => {
  const [placeholder, setPlaceholder] = createSignal(false);
  const [enabled, setEnabled] = createSignal(true);
  const task: TaskEntityWithProperties = {
    type: 'document',
    fileType: 'md',
    id: 'task',
    name: 'Task',
    ownerId: 'viewer',
    createdAt: new Date(),
    updatedAt: new Date(),
    subType: { type: 'task', is_completed: false },
    properties: [],
  };
  fixture.query = {
    isLoading: false,
    get isPlaceholderData() {
      return placeholder();
    },
    data: { entities: [task] },
  };
  createRoot((dispose) => {
    try {
      const source = useTasksDataSource(
        {
          tab: 'team-tasks',
          search: '',
          facets: {},
          groupBy: 'none',
          sort: [],
        },
        {
          userId: () => 'viewer',
          tagSets: () => [],
          tagSetsReady: () => true,
          isGroupExpanded: () => true,
          taskIds: () => ['task'],
          enabled,
        }
      );
      expect(source.items()).toHaveLength(1);
      expect(source.isLoading()).toBe(false);
      setPlaceholder(true);
      expect(source.items()).toEqual([]);
      expect(source.isLoading()).toBe(true);
      setPlaceholder(false);
      expect(source.items()).toHaveLength(1);
      expect(source.isLoading()).toBe(false);
      setEnabled(false);
      expect(source.items()).toEqual([]);
      expect(source.isLoading()).toBe(false);
    } finally {
      dispose();
    }
  });
});
