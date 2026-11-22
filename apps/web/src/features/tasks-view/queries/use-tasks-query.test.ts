import type { TaskEntityWithProperties } from '@entity/types/entity';
import type { GroupedSoupPaging } from '@queries/soup/graphql/create-grouped-soup-live-query';
import type { CreateGroupedSoupQueriesArgs } from '@queries/soup/grouped/create-grouped-soup-queries';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  groupQueries: new Map<string, unknown>(),
  groupArgs: undefined as CreateGroupedSoupQueriesArgs | undefined,
  calls: [] as { args: () => unknown; options?: () => unknown }[],
  searchState: vi.fn(),
  mapItem: vi.fn(),
  deletedKeys: (() => new Set()) as () => ReadonlySet<string>,
}));
vi.mock(
  '@queries/soup/graphql/optimistic-deletions',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@queries/soup/graphql/optimistic-deletions')
    >()),
    usePendingGraphqlSoupDeleteKeys: () => () => fixture.deletedKeys(),
  })
);
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: () => ({ isSuccess: false, data: [] }),
}));
vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/collection/row-store')),
  ...(await import('@app/features/soup/collection/transforms')),
  useSearchContext: () => ({
    entityPool: () => () => [],
    routinePool: () => [],
  }),
  createSearchState: () => {
    fixture.searchState();
    return {
      isSearching: () => false,
      usesServiceSearch: () => false,
      isSettling: () => false,
    };
  },
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/task-properties')),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notificationsByEntity: () => ({}) }),
}));
vi.mock('@queries/soup/transform-utils', () => ({
  mapApiSoupItemToEntity: fixture.mapItem,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: (args: () => unknown, options?: () => unknown) => {
    fixture.calls.push({ args, options });
    return fixture.query;
  },
}));
vi.mock('@queries/soup/grouped/create-grouped-soup-queries', () => ({
  createGroupedSoupQueries: (args: CreateGroupedSoupQueriesArgs) => {
    fixture.groupArgs = args;
    return { map: () => fixture.groupQueries };
  },
}));

import type { TasksTab } from '../types';
import { useTasksDataSource } from './use-tasks-query';

it('delegates grouped task pagination to the current Soup query owner', async () => {
  const [paging, setPaging] = createSignal<GroupedSoupPaging>();
  const [hasMore, setHasMore] = createSignal(true);
  const task: TaskEntityWithProperties = {
    type: 'document',
    fileType: 'md',
    id: 'task',
    name: 'Task',
    ownerId: 'viewer',
    subType: { type: 'task', is_completed: false },
    properties: [],
  };
  const fetchNextPage = vi.fn(async () => {
    setHasMore(false);
  });
  fixture.query = {
    isLoading: false,
    isPending: false,
    isPlaceholderData: false,
    get groupedPaging() {
      return paging();
    },
    data: {
      entities: [task],
      itemsById: {},
      groups: [
        {
          key: 'todo',
          label: 'To do',
          totalCount: 2,
          itemIds: [task.id],
          nextCursor: 'next',
        },
      ],
    },
  };
  // The group reader consumes the owner's live capability, not another cursor chain.
  fixture.groupQueries = new Map([
    [
      'todo',
      {
        data: () => ({ entities: [] }),
        hasNextPage: () =>
          fixture.groupArgs?.groupedPaging?.()?.hasNextPage('todo') ?? false,
        isFetchingNextPage: () => false,
        fetchNextPage: () =>
          fixture.groupArgs?.groupedPaging?.()?.fetchNextPage('todo'),
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
      }
    );
  });
  try {
    expect(source.items().some((row) => row.kind === 'load-more')).toBe(false);
    setPaging({
      hasNextPage: hasMore,
      isFetchingNextPage: () => false,
      error: () => null,
      fetchNextPage,
      resetToInitialPage: () => {},
    });
    expect(source.items().some((row) => row.kind === 'load-more')).toBe(true);
    await source.loadMoreGroup('todo');
    expect(fetchNextPage).toHaveBeenCalledExactlyOnceWith('todo');
    expect(source.items().some((row) => row.kind === 'load-more')).toBe(false);
  } finally {
    cleanup();
    fixture.groupQueries = new Map();
    fixture.groupArgs = undefined;
  }
});

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

const COMPANIES = '00000001-0000-0000-0000-00000000000c';

function crmTask(id: string, companyIds: string[] = []) {
  return {
    type: 'document',
    fileType: 'md',
    id,
    name: id,
    ownerId: 'viewer',
    createdAt: new Date(),
    updatedAt: new Date(),
    subType: { type: 'task', is_completed: false },
    properties: companyIds.length
      ? [
          {
            definition: { id: COMPANIES },
            value: {
              type: 'EntityReference',
              value: companyIds.map((entity_id) => ({
                entity_type: 'COMPANY',
                entity_id,
              })),
            },
          },
        ]
      : [],
  } as unknown as TaskEntityWithProperties;
}

function crmSource(groupBy: 'none' | 'status' = 'none') {
  return useTasksDataSource(
    { tab: 'team-tasks', search: '', facets: {}, groupBy, sort: [] },
    {
      userId: () => 'viewer',
      tagSets: () => [],
      tagSetsReady: () => true,
      isGroupExpanded: () => true,
      crm: () => ({ type: 'company', id: 'acme' }),
    }
  );
}

it('keeps server-matched CRM tasks that only mention the record', () => {
  fixture.calls = [];
  fixture.query = {
    isLoading: false,
    isPending: false,
    isPlaceholderData: false,
    data: { entities: [crmTask('mention-only'), crmTask('linked', ['acme'])] },
  };
  createRoot((dispose) => {
    try {
      const source = crmSource();
      expect(
        source
          .items()
          .flatMap((row) => (row.kind === 'entity' ? [row.entity.id] : []))
      ).toEqual(['mention-only', 'linked']);
      const query = fixture.calls[0]?.args() as {
        body: Record<string, unknown>;
      };
      expect(query.body.crma).toEqual({ company: 'acme' });
      expect(query.body.propf).toBeUndefined();
      // The search service cannot express the scope, so it is not used.
      expect(fixture.searchState).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});

it('keeps CRM continuation rows the server returned for a group', () => {
  fixture.query = {
    isLoading: false,
    isPending: false,
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
  fixture.groupQueries = new Map([
    [
      'todo',
      {
        data: () => ({
          entities: [crmTask('contact-mention'), crmTask('linked', ['acme'])],
        }),
        hasNextPage: () => false,
        isFetchingNextPage: () => false,
        fetchNextPage: async () => {},
      },
    ],
  ]);
  createRoot((dispose) => {
    try {
      const source = crmSource('status');
      expect(
        source
          .items()
          .flatMap((row) => (row.kind === 'entity' ? [row.entity.id] : []))
      ).toEqual(['contact-mention', 'linked']);
    } finally {
      dispose();
      fixture.groupQueries = new Map();
    }
  });
});

it('admits only optimistic CRM tasks that name the record', () => {
  fixture.calls = [];
  fixture.query = {
    isLoading: false,
    isPending: false,
    isPlaceholderData: false,
    data: { entities: [] },
  };
  createRoot((dispose) => {
    try {
      crmSource();
      const options = fixture.calls[0]?.options?.() as {
        meta: { insertFilter: (item: unknown) => boolean };
      };
      fixture.mapItem.mockReturnValueOnce(crmTask('created', ['acme']));
      expect(options.meta.insertFilter({})).toBe(true);
      fixture.mapItem.mockReturnValueOnce(crmTask('unrelated', ['globex']));
      expect(options.meta.insertFilter({})).toBe(false);
      fixture.mapItem.mockReturnValueOnce(crmTask('cached'));
      expect(options.meta.insertFilter({})).toBe(false);
    } finally {
      dispose();
    }
  });
});

it('admits optimistic CRM tasks whose custom entity property names the record', () => {
  fixture.calls = [];
  fixture.query = {
    isLoading: false,
    isPending: false,
    isPlaceholderData: false,
    data: { entities: [] },
  };
  const taskReferencing = (
    definition: { is_system: boolean; owner: { scope: string } },
    entity_type: string,
    entity_id: string
  ) =>
    ({
      ...crmTask('custom'),
      properties: [
        {
          definition: {
            id: 'custom-contact',
            data_type: 'ENTITY',
            ...definition,
          },
          value: {
            type: 'EntityReference',
            value: [
              { entity_type: 'USER', entity_id: 'viewer' },
              { entity_type, entity_id },
            ],
          },
        },
      ],
    }) as unknown as TaskEntityWithProperties;
  const personal = { is_system: false, owner: { scope: 'user' } };
  // A row read over GraphQL carries no owner: every definition says system.
  const overGraphql = { is_system: false, owner: { scope: 'system' } };
  createRoot((dispose) => {
    try {
      crmSource();
      const options = fixture.calls[0]?.options?.() as {
        meta: { insertFilter: (item: unknown) => boolean };
      };
      fixture.mapItem.mockReturnValueOnce(
        taskReferencing(personal, 'COMPANY', 'acme')
      );
      expect(options.meta.insertFilter({})).toBe(true);
      fixture.mapItem.mockReturnValueOnce(
        taskReferencing(overGraphql, 'COMPANY', 'acme')
      );
      expect(options.meta.insertFilter({})).toBe(true);
      // The company's id as a contact, and another company, are not the record.
      fixture.mapItem.mockReturnValueOnce(
        taskReferencing(personal, 'CONTACT', 'acme')
      );
      expect(options.meta.insertFilter({})).toBe(false);
      fixture.mapItem.mockReturnValueOnce(
        taskReferencing(personal, 'COMPANY', 'globex')
      );
      expect(options.meta.insertFilter({})).toBe(false);
      // A built-in property and a database column are not custom properties.
      fixture.mapItem.mockReturnValueOnce(
        taskReferencing(
          { is_system: true, owner: { scope: 'system' } },
          'COMPANY',
          'acme'
        )
      );
      expect(options.meta.insertFilter({})).toBe(false);
      fixture.mapItem.mockReturnValueOnce(
        taskReferencing(
          { is_system: false, owner: { scope: 'database' } },
          'COMPANY',
          'acme'
        )
      );
      expect(options.meta.insertFilter({})).toBe(false);
    } finally {
      dispose();
    }
  });
});

it('keeps activity membership in list and grouped paging and excludes optimistic rows', () => {
  fixture.calls = [];
  fixture.query = {
    isLoading: false,
    isPending: false,
    isPlaceholderData: false,
    data: { entities: [] },
  };
  createRoot((dispose) => {
    try {
      useTasksDataSource(
        {
          tab: 'team-tasks',
          search: '',
          facets: {},
          groupBy: 'date',
          sort: [],
        },
        {
          userId: () => 'viewer',
          tagSets: () => [],
          tagSetsReady: () => true,
          isGroupExpanded: () => true,
          crm: () => ({ type: 'activity' }),
          board: () => true,
        }
      );
      const call = fixture.calls[0];
      expect(
        (call?.args() as { body: { crma: unknown } } | undefined)?.body.crma
      ).toBe('activity');
      expect(fixture.groupArgs?.soupBody().crma).toBe('activity');
      const meta = call?.options?.() as {
        meta: { insertFilter: (item: unknown) => boolean };
      };
      fixture.mapItem.mockReturnValueOnce(crmTask('linked', ['acme']));
      expect(meta.meta.insertFilter({})).toBe(false);
      expect(fixture.searchState).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});

it('pauses task reads across project views and resumes when returning to tasks', () => {
  fixture.calls = [];
  fixture.query = {
    isLoading: false,
    isPending: false,
    data: { entities: [] },
  };
  createRoot((dispose) => {
    try {
      const [tab, setTab] = createSignal<TasksTab>('my-projects');
      useTasksDataSource(
        {
          get tab() {
            return tab();
          },
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
        }
      );
      const options = fixture.calls[0]?.options;
      expect(options?.()).toMatchObject({ enabled: false });
      setTab('created-projects');
      expect(options?.()).toMatchObject({ enabled: false });
      setTab('projects');
      expect(options?.()).toMatchObject({ enabled: false });
      setTab('my-tasks');
      expect(options?.()).toMatchObject({ enabled: true });
    } finally {
      dispose();
    }
  });
});

async function createdTaskFixture(initiallyLoading = false) {
  const { buildOptimisticTask } = await import('../core/optimistic-task');
  const { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } = await import(
    '@property/constants'
  );
  const inProject = (id: string, projectId = 'project') =>
    buildOptimisticTask({
      id,
      title: id,
      ownerId: 'viewer',
      properties: [
        [
          SYSTEM_PROPERTY_IDS.PROJECT,
          {
            valueType: 'ENTITY',
            refs: [{ entity_id: projectId, entity_type: 'INITIATIVE' }],
          },
        ],
      ],
      definitions: new Map(),
      now: new Date('2026-11-22T12:00:00Z'),
    });
  const [entities, setEntities] = createSignal<TaskEntityWithProperties[]>([]);
  const [loading, setLoading] = createSignal(initiallyLoading);
  const [optimistic, setOptimistic] = createSignal<
    { entity: TaskEntityWithProperties; pending: boolean }[]
  >([]);
  const [showsPending, setShowsPending] = createSignal(true);
  const [known, setKnown] = createSignal<string[] | undefined>();
  const [deleted, setDeleted] = createSignal<ReadonlySet<string>>(new Set());
  const [placeholder, setPlaceholder] = createSignal(false);
  fixture.deletedKeys = deleted;
  const onListed = vi.fn();
  fixture.query = {
    get isLoading() {
      return loading();
    },
    get isPending() {
      return loading();
    },
    get isPlaceholderData() {
      return placeholder();
    },
    get data() {
      return {
        entities: entities(),
        itemsById: {},
        groups: [
          {
            key: 'done',
            label: 'Done',
            totalCount: entities().length,
            itemIds: entities().map((task) => task.id),
          },
        ],
      };
    },
  };
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
        reference: () => ({
          propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
          entityId: 'project',
        }),
        optimisticTasks: optimistic,
        showsPendingTasks: showsPending,
        isOptimisticTaskKnown: (id) => known()?.includes(id) ?? true,
        onOptimisticTasksListed: onListed,
      }
    );
  });
  const shape = () =>
    source
      .items()
      .map((row) =>
        row.kind === 'entity'
          ? row.entity.id
          : row.kind === 'group-header'
            ? `#${row.groupId}:${row.count}`
            : row.kind
      );
  return {
    notStarted: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
    inProject,
    source,
    shape,
    onListed,
    cleanup,
    setEntities,
    setLoading,
    setOptimistic,
    setShowsPending,
    setKnown,
    setDeleted,
    setPlaceholder,
  };
}

it('shows created tasks in their group until the query lists them', async () => {
  const f = await createdTaskFixture();
  const listed = f.inProject('listed');
  f.setEntities([listed]);
  f.setOptimistic([
    { entity: f.inProject('temp'), pending: true },
    { entity: f.inProject('elsewhere', 'other'), pending: true },
  ]);
  try {
    // A Not started group no page had opens for it; another project's task stays out.
    expect(f.shape()).toEqual([
      '#done:1',
      'listed',
      `#${f.notStarted}:1`,
      'temp',
    ]);
    expect(f.source.isPendingTask?.('temp')).toBe(true);
    expect(f.source.isPendingTask?.('listed')).toBe(false);

    // The server created it: the row takes its real id and can be opened.
    f.setOptimistic([
      { entity: { ...f.inProject('temp'), id: 'task' }, pending: false },
    ]);
    expect(f.shape()).toEqual([
      '#done:1',
      'listed',
      `#${f.notStarted}:1`,
      'task',
    ]);
    expect(f.source.isPendingTask?.('task')).toBe(false);
    expect(f.onListed).not.toHaveBeenCalled();

    // The query lists it itself: the stand-in is released.
    f.setEntities([listed, f.inProject('task')]);
    expect(f.onListed).toHaveBeenCalledWith(['task']);
  } finally {
    f.cleanup();
  }
});

it('keeps tasks being created off layouts that open and drag cards', async () => {
  const f = await createdTaskFixture();
  f.setEntities([f.inProject('listed')]);
  f.setShowsPending(false);
  f.setOptimistic([
    { entity: f.inProject('temp'), pending: true },
    { entity: f.inProject('created'), pending: false },
  ]);
  try {
    // Board and Gantt get only the created task; counts leave out the other.
    expect(f.source.boardRows?.().map((row) => row.id)).toEqual(
      f.source.items().map((row) => row.id)
    );
    expect(f.shape()).toEqual([
      '#done:1',
      'listed',
      `#${f.notStarted}:1`,
      'created',
    ]);
  } finally {
    f.cleanup();
  }
});

it('shows a task created before the first page loads, in its group', async () => {
  const f = await createdTaskFixture(true);
  f.setOptimistic([{ entity: f.inProject('temp'), pending: true }]);
  try {
    expect(f.shape()).toEqual([`#${f.notStarted}:1`, 'temp']);
    expect(f.source.isLoading()).toBe(false);
  } finally {
    f.cleanup();
  }
});

it('follows a create that settles while a new page loads', async () => {
  const f = await createdTaskFixture();
  f.setEntities([f.inProject('listed')]);
  f.setOptimistic([{ entity: f.inProject('temp'), pending: true }]);
  try {
    // The query reloads (a filter or sort change) and keeps its last rows.
    f.setLoading(true);
    f.setOptimistic([
      { entity: { ...f.inProject('temp'), id: 'task' }, pending: false },
    ]);
    expect(f.shape()).toContain('task');
    expect(f.shape()).not.toContain('temp');

    // A failed create leaves no row behind under its temporary id.
    f.setOptimistic([{ entity: f.inProject('other'), pending: true }]);
    f.setOptimistic([]);
    expect(f.shape()).toEqual(['#done:1', 'listed']);
  } finally {
    f.cleanup();
  }
});

it('keeps a stand-in until the host knows the task as well', async () => {
  const f = await createdTaskFixture();
  f.setKnown([]);
  f.setOptimistic([
    { entity: { ...f.inProject('temp'), id: 'task' }, pending: false },
  ]);
  try {
    f.setEntities([f.inProject('task')]);
    expect(f.onListed).not.toHaveBeenCalled();
    expect(f.shape()).toEqual(['#done:1', 'task']);

    f.setKnown(['task']);
    expect(f.onListed).toHaveBeenCalledWith(['task']);
  } finally {
    f.cleanup();
  }
});

it('drops a created task deleted before the query lists it', async () => {
  const f = await createdTaskFixture();
  f.setEntities([f.inProject('listed')]);
  f.setOptimistic([
    { entity: { ...f.inProject('temp'), id: 'task' }, pending: false },
  ]);
  try {
    expect(f.shape()).toContain('task');
    f.setDeleted(new Set(['GraphqlSoupDocument:task']));
    expect(f.shape()).toEqual(['#done:1', 'listed']);
    expect(f.onListed).toHaveBeenCalledWith(['task']);
  } finally {
    f.cleanup();
  }
});

it('opens a created task’s group where the server orders it', async () => {
  const { placeOptimisticTasks } = await import('./use-tasks-query');
  const f = await createdTaskFixture();
  f.cleanup();
  const order = ['high', 'medium', 'low'];
  const server = [
    { id: 'high', label: 'High', entities: [f.inProject('a')], count: 1 },
    { id: 'low', label: 'Low', entities: [f.inProject('b')], count: 1 },
  ];
  const placed = placeOptimisticTasks(server, [f.inProject('temp')], {
    groupKeys: () => ['medium'],
    groupLabel: (key) => key,
    compareGroups: (a, b) => order.indexOf(a) - order.indexOf(b),
    sort: (entities) => entities,
  });
  expect(placed.map((group) => [group.id, group.count])).toEqual([
    ['high', 1],
    ['medium', 1],
    ['low', 1],
  ]);
  // The server's groups are left as they were.
  expect(server.map((group) => group.id)).toEqual(['high', 'low']);
});

it('leaves a created task that sorts past the loaded rows to its later page', async () => {
  const { placeOptimisticTasks } = await import('./use-tasks-query');
  const f = await createdTaskFixture();
  f.cleanup();
  const placement = {
    groupKeys: () => ['todo'],
    groupLabel: (key: string) => key,
    compareGroups: () => 0,
    // Oldest first: a new task sorts last.
    sort: (entities: ReturnType<typeof f.inProject>[]) =>
      [...entities].sort((a, b) =>
        a.id === 'temp' ? 1 : b.id === 'temp' ? -1 : 0
      ),
  };
  const loaded = [f.inProject('a'), f.inProject('b')];
  // Fifty-one in the group, two loaded: the server may count it already.
  const paged = [{ id: 'todo', label: 'Todo', entities: loaded, count: 51 }];
  expect(
    placeOptimisticTasks(paged, [f.inProject('temp')], placement).map(
      (group) => [group.count, group.entities.map((task) => task.id)]
    )
  ).toEqual([[51, ['a', 'b']]]);

  // With every row loaded, it shows at the end and counts.
  const whole = [{ id: 'todo', label: 'Todo', entities: loaded, count: 2 }];
  expect(
    placeOptimisticTasks(whole, [f.inProject('temp')], placement).map(
      (group) => [group.count, group.entities.map((task) => task.id)]
    )
  ).toEqual([[3, ['a', 'b', 'temp']]]);
});

it('keeps a created task while the list shows a previous page', async () => {
  const f = await createdTaskFixture();
  const created = { ...f.inProject('temp'), id: 'task' };
  f.setOptimistic([{ entity: created, pending: false }]);
  try {
    // The previous page lists it, but the page loading in its place may not.
    f.setPlaceholder(true);
    f.setEntities([created]);
    expect(f.onListed).not.toHaveBeenCalled();
    f.setPlaceholder(false);
    expect(f.onListed).toHaveBeenCalledWith(['task']);
  } finally {
    f.cleanup();
  }
});
