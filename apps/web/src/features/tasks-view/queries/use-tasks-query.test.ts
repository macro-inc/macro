import type { TaskEntityWithProperties } from '@entity/types/entity';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  groupQueries: new Map<string, unknown>(),
}));
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
  createGroupedSoupQueries: () => ({ map: () => fixture.groupQueries }),
}));

import { useTasksDataSource } from './use-tasks-query';

it.each([false, true])(
  'loads all group pages only when requested (%s)',
  async (loadAll) => {
    const tasks = Array.from({ length: 20 }, (_, index) => ({
      type: 'document',
      fileType: 'md',
      id: `task-${index}`,
      name: `Task ${index}`,
      ownerId: 'viewer',
      createdAt: new Date(),
      updatedAt: new Date(),
      subType: { type: 'task', is_completed: false },
      properties: [],
    })) as unknown as TaskEntityWithProperties[];
    const [loaded, setLoaded] = createSignal(false);
    const fetchNextPage = vi.fn(async () => {
      setLoaded(true);
    });
    fixture.query = {
      isLoading: false,
      isPending: false,
      isPlaceholderData: false,
      hasNextPage: false,
      data: {
        entities: tasks.slice(0, 10),
        itemsById: {},
        groups: [
          {
            key: 'todo',
            label: 'To do',
            displayOrder: 0,
            totalCount: 20,
            itemIds: tasks.slice(0, 10).map((task) => task.id),
            nextCursor: 'next',
          },
        ],
      },
    };
    fixture.groupQueries = new Map([
      [
        'todo',
        {
          key: 'todo',
          data: () => ({ entities: loaded() ? tasks.slice(10) : [] }),
          hasNextPage: () => !loaded(),
          isFetchingNextPage: () => false,
          fetchNextPage,
          error: () => null,
        },
      ],
    ]);
    let cleanup = () => {};
    const source = createRoot((dispose) => {
      cleanup = dispose;
      return useTasksDataSource(
        {
          tab: 'team-tasks',
          search: '',
          facets: {},
          groupBy: 'status',
          sort: [],
        },
        {
          userId: () => 'viewer',
          tagSets: () => [],
          tagSetsReady: () => true,
          isGroupExpanded: () => true,
          loadAll,
        }
      );
    });
    try {
      await vi.waitFor(() =>
        expect(
          source.items().filter((row) => row.kind === 'entity')
        ).toHaveLength(loadAll ? 20 : 10)
      );
      expect(fetchNextPage).toHaveBeenCalledTimes(loadAll ? 1 : 0);
      expect(source.items().some((row) => row.kind === 'load-more')).toBe(
        !loadAll
      );
    } finally {
      cleanup();
      fixture.groupQueries = new Map();
    }
  }
);

it('retains referenced list rows but hides stale board groups and inaccessible tasks', () => {
  const [placeholder, setPlaceholder] = createSignal(false);
  const [enabled, setEnabled] = createSignal(true);
  const task = {
    type: 'document',
    fileType: 'md',
    id: 'task',
    name: 'Task',
    ownerId: 'viewer',
    createdAt: new Date(),
    updatedAt: new Date(),
    subType: { type: 'task', is_completed: false },
    properties: [
      {
        definition: { id: 'project-definition' },
        value: {
          type: 'EntityReference',
          value: [{ entity_type: 'INITIATIVE', entity_id: 'project' }],
        },
      },
    ],
  } as unknown as TaskEntityWithProperties;
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
          reference: () => ({
            propertyDefinitionId: 'project-definition',
            entityId: 'project',
          }),
          enabled,
        }
      );
      expect(source.items()).toHaveLength(1);
      expect(source.boardRows?.()).toHaveLength(1);
      expect(source.isLoading()).toBe(false);
      setPlaceholder(true);
      expect(source.items()).toHaveLength(1);
      expect(source.boardRows?.()).toEqual([]);
      expect(source.isLoading()).toBe(false);
      setPlaceholder(false);
      setEnabled(false);
      expect(source.items()).toEqual([]);
      expect(source.boardRows?.()).toEqual([]);
      expect(source.isLoading()).toBe(false);
    } finally {
      dispose();
    }
  });
});

it.each([false, true])(
  'scopes grouped continuation rows to the referenced entity (board: %s)',
  (board) => {
    const companies = 'companies-definition';
    const task = (id: string, companyId: string) =>
      ({
        type: 'document',
        fileType: 'md',
        id,
        name: id,
        ownerId: 'viewer',
        createdAt: new Date(),
        updatedAt: new Date(),
        subType: { type: 'task', is_completed: false },
        properties: [
          {
            definition: { id: companies },
            value: {
              type: 'EntityReference',
              value: [{ entity_type: 'COMPANY', entity_id: companyId }],
            },
          },
        ],
      }) as unknown as TaskEntityWithProperties;
    fixture.query = {
      isLoading: false,
      isPlaceholderData: false,
      data: {
        entities: [],
        itemsById: {},
        groups: [
          {
            key: 'todo',
            label: 'To do',
            displayOrder: 0,
            totalCount: 2,
            itemIds: [],
            nextCursor: 'next',
          },
        ],
      },
    };
    // A "Load more" page holding one task that no longer references Acme.
    fixture.groupQueries = new Map([
      [
        'todo',
        {
          data: () => ({
            entities: [task('linked', 'acme'), task('unlinked', 'globex')],
          }),
          hasNextPage: () => false,
          isFetchingNextPage: () => false,
          fetchNextPage: async () => {},
        },
      ],
    ]);
    createRoot((dispose) => {
      try {
        const source = useTasksDataSource(
          {
            tab: 'team-tasks',
            search: '',
            facets: {},
            groupBy: 'status',
            sort: [],
          },
          {
            userId: () => 'viewer',
            tagSets: () => [],
            tagSetsReady: () => true,
            isGroupExpanded: () => !board,
            board: () => board,
            reference: () => ({
              propertyDefinitionId: companies,
              entityId: 'acme',
            }),
          }
        );
        const rows = board ? source.boardRows?.() : source.items();
        expect(
          rows?.flatMap((row) => (row.kind === 'entity' ? [row.entity.id] : []))
        ).toEqual(['linked']);
      } finally {
        dispose();
        fixture.groupQueries = new Map();
      }
    });
  }
);

it('exposes uncollapsed board rows and hides stale groups during query changes', () => {
  const [pending, setPending] = createSignal(false);
  const task: TaskEntityWithProperties = {
    type: 'document',
    fileType: 'md',
    id: 'task',
    name: 'Task',
    ownerId: 'viewer',
    subType: { type: 'task', is_completed: false },
    properties: [],
  };

  fixture.query = {
    get isPending() {
      return pending();
    },
    get isLoading() {
      return pending();
    },
    data: {
      entities: [task],
      itemsById: {},
      groups: [
        { key: 'todo', label: 'To do', totalCount: 1, itemIds: ['task'] },
      ],
    },
  };
  fixture.groupQueries = new Map();

  createRoot((dispose) => {
    try {
      const source = useTasksDataSource(
        {
          tab: 'team-tasks',
          search: '',
          facets: {},
          groupBy: 'status',
          sort: [],
        },
        {
          userId: () => 'viewer',
          tagSets: () => [],
          tagSetsReady: () => true,
          isGroupExpanded: () => false,
          board: () => true,
        }
      );

      expect(
        source.items().filter((row) => row.kind === 'entity')
      ).toHaveLength(0);
      expect(
        source.boardRows?.().filter((row) => row.kind === 'entity')
      ).toHaveLength(1);

      setPending(true);

      expect(source.boardRows?.()).toEqual([]);
      expect(source.boardLoading?.()).toBe(true);

      setPending(false);

      expect(
        source.boardRows?.().filter((row) => row.kind === 'entity')
      ).toHaveLength(1);
    } finally {
      dispose();
    }
  });
});
