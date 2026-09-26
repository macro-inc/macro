import type { UseTasksDataSourceOptions } from '@app/features/tasks-view/queries/use-tasks-query';
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

it('uses complete current membership and disables the shared source immediately on access loss', async () => {
  await new Promise<void>((resolve, reject) =>
    createRoot((dispose) => {
      const ids = Array.from({ length: 150 }, (_, index) => `task-${index}`);
      const [project, setProject] = createSignal<ProjectDetail | undefined>({
        id: 'project',
        name: 'Launch',
        descriptionDocumentId: 'description',
        ownerId: 'owner',
        memberIds: [],
        taskIds: ids,
        access: 'view',
        createdAt: '',
        updatedAt: '',
        sharing: {},
      });
      const refresh = vi.fn(async () => {});
      const source = createProjectTasksDataSource(
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
      expect(mock.options?.taskIds?.()).toEqual(ids);
      expect(mock.options?.enabled?.()).toBe(true);
      setProject(undefined);
      expect(mock.options?.taskIds?.()).toEqual([]);
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
