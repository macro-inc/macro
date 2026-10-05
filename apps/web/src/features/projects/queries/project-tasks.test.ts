import type { UseTasksDataSourceOptions } from '@app/features/tasks-view/queries/use-tasks-query';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../core/project';
import { createProjectTasksDataSource } from './project-tasks';

const mock = vi.hoisted(() => ({
  options: undefined as UseTasksDataSourceOptions | undefined,
  refresh: vi.fn(async () => {}),
}));
vi.mock('@app/features/tasks-view/queries/use-tasks-query', () => ({
  useTasksDataSource: (_: unknown, options: UseTasksDataSourceOptions) => {
    mock.options = options;
    return {
      items: () => [],
      isLoading: () => false,
      isFetching: () => false,
      error: () => undefined,
      hasMore: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
      loadMoreGroup: async () => {},
      refresh: mock.refresh,
    };
  },
}));

it('scopes tasks to the Project property and disables the shared source immediately on access loss', async () => {
  await new Promise<void>((resolve, reject) =>
    createRoot((dispose) => {
      const [project, setProject] = createSignal<ProjectDetail | undefined>({
        id: 'project',
        name: 'Launch',
        ownerId: 'owner',
        memberIds: [],
        taskIds: [],
        access: 'view',
        createdAt: '',
        updatedAt: '',
      });
      const refresh = vi.fn(async () => {});
      const source = createProjectTasksDataSource(
        'project',
        {
          project,
          properties: () => [],
          loading: () => false,
          error: () => undefined,
          refresh,
        },
        {
          tab: 'team-tasks',
          groupBy: 'none',
          search: '',
          sort: [],
          facets: {},
        },
        {
          userId: () => 'user',
          tagSets: () => [],
          tagSetsReady: () => true,
          isGroupExpanded: () => true,
        }
      );
      expect(mock.options?.reference?.()).toEqual({
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
        entityId: 'project',
      });
      expect(mock.options?.enabled?.()).toBe(true);
      expect(mock.options?.loadAll).toBe(true);
      setProject(undefined);
      expect(mock.options?.enabled?.()).toBe(false);
      source
        .refresh()
        .then(() => {
          expect(refresh).toHaveBeenCalledOnce();
          expect(mock.refresh).not.toHaveBeenCalled();
          dispose();
          resolve();
        })
        .catch(reject);
    })
  );
});
