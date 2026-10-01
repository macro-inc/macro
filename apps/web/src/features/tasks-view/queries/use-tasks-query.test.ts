import type { TaskEntityWithProperties } from '@entity/types/entity';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/collection/row-store')),
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
vi.mock('@queries/soup/transform-utils', () => ({
  mapApiSoupItemToEntity: vi.fn(),
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => fixture.query,
}));
vi.mock('@queries/soup/grouped/create-grouped-soup-queries', () => ({
  createGroupedSoupQueries: () => ({ map: () => new Map() }),
}));

import { useTasksDataSource } from './use-tasks-query';

it('retains cached rows during membership changes but filters them by current access', () => {
  const [placeholder, setPlaceholder] = createSignal(false);
  const [enabled, setEnabled] = createSignal(true);
  const [members, setMembers] = createSignal(['task']);
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
          taskIds: members,
          enabled,
        }
      );
      expect(source.items()).toHaveLength(1);
      expect(source.isLoading()).toBe(false);
      setPlaceholder(true);
      expect(source.items()).toHaveLength(1);
      expect(source.isLoading()).toBe(false);
      setMembers([]);
      expect(source.items()).toEqual([]);
      setMembers(['task']);
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
