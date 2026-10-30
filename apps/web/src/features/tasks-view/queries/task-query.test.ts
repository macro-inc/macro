import { describe, expect, it, vi } from 'vitest';
import {
  captureTaskSavedView,
  decodeTaskSavedView,
  materializeTaskSavedView,
  readTaskSavedView,
} from '../filters/task-saved-view';
import { type BuildTaskQueryOptions, buildTaskQuery } from './task-query';
import { buildTaskSearchRequest } from './task-search';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const options: BuildTaskQueryOptions = {
  tab: 'team-tasks',
  userId: 'user',
  facets: { status: ['in-progress'] },
  groupBy: 'status',
  sort: [{ id: 'updated_at', reversed: true }],
};

describe('task reference scope', () => {
  const reference = {
    propertyDefinitionId: '00000001-0000-0000-0000-00000000000c',
    entityId: 'company-1',
  };

  it('ANDs the referencing property into the list query', () => {
    const query = buildTaskQuery({ ...options, facets: {}, reference });
    expect(query.body.df).toEqual({ l: { dst: 'task' } });
    expect(query.body.propf).toEqual({
      l: { pd: reference.propertyDefinitionId, v: { er: 'company-1' } },
    });
  });

  it('keeps the scope when searching', () => {
    const request = buildTaskSearchRequest({
      query: 'renewal',
      matchType: 'partial',
      tab: 'team-tasks',
      userId: 'user',
      facets: {},
      reference,
    });
    expect(request.body.filters?.property_filters).toEqual([
      {
        property_definition_id: reference.propertyDefinitionId,
        entity_type: 'TASK',
        entity_ids: ['company-1'],
      },
    ]);
  });
});

describe('task CRM scope', () => {
  it('preserves activity membership in list, search, board and Gantt queries', () => {
    const list = buildTaskQuery({
      ...options,
      crm: { type: 'activity' },
      groupBy: 'date',
    });
    const search = buildTaskQuery({
      ...options,
      crm: { type: 'activity' },
      groupBy: 'date',
      nameContains: 'renewal',
    });
    const board = buildTaskQuery({
      ...options,
      crm: { type: 'activity' },
      groupBy: 'project',
      board: true,
    });
    const gantt = buildTaskQuery({
      ...options,
      crm: { type: 'activity' },
      groupBy: 'status',
    });
    for (const query of [list, search, board, gantt]) {
      expect(query.body.crma).toBe('activity');
      expect(JSON.stringify(query.body)).not.toContain('company-1');
    }
    expect(list.groupBy).toEqual({ type: 'date' });
    expect(search.body.df).toEqual({
      '&': [{ l: { dst: 'task' } }, { l: { nc: 'renewal' } }],
    });
    expect(board.groupBy).toEqual({
      type: 'property',
      propertyDefinitionId: '00000001-0000-0000-0000-000000000014',
    });
    expect(gantt.groupBy).toEqual({
      type: 'property',
      propertyDefinitionId: '00000001-0000-0000-0000-000000000002',
    });
  });

  it('scopes the list to the record without a property-only filter', () => {
    const query = buildTaskQuery({
      ...options,
      facets: {},
      crm: { type: 'company', id: 'company-1' },
    });
    expect(query.body.crma).toEqual({ company: 'company-1' });
    expect(query.body.propf).toBeUndefined();
    expect(query.body.df).toEqual({ l: { dst: 'task' } });
    // Grouping and sort still apply to the scoped list.
    expect(query.groupBy).toEqual({
      type: 'property',
      propertyDefinitionId: '00000001-0000-0000-0000-000000000002',
    });
  });

  it('searches by name inside the same scope', () => {
    const query = buildTaskQuery({
      ...options,
      facets: {},
      crm: { type: 'contact', id: 'contact-1' },
      nameContains: 'renewal',
    });
    expect(query.body.crma).toEqual({ contact: 'contact-1' });
    expect(query.body.df).toEqual({
      '&': [{ l: { dst: 'task' } }, { l: { nc: 'renewal' } }],
    });
  });
});

it('uses explicit Project property grouping for board editing and Project grouping for lists', () => {
  const boardQuery = buildTaskQuery({
    ...options,
    groupBy: 'project',
    board: true,
  });
  const listQuery = buildTaskQuery({ ...options, groupBy: 'project' });
  const sortedBoardQuery = buildTaskQuery({ ...options, board: true });

  expect(boardQuery.groupBy).toEqual({
    type: 'property',
    propertyDefinitionId: '00000001-0000-0000-0000-000000000014',
  });
  expect(listQuery.groupBy).toEqual({
    type: 'project',
  });
  expect(sortedBoardQuery.params).toMatchObject({
    sort_method: 'updated_at',
    sort_direction: 'asc',
  });
});

describe('saved task presentation', () => {
  it('round-trips layout, grouping, and ordered sorts through capture, read, and materialization', () => {
    const captured = captureTaskSavedView({
      tab: 'team-tasks',
      facets: {},
      layout: 'gantt',
      groupBy: 'project',
      sort: [
        { id: 'created_at', reversed: true },
        { id: 'viewed_at', reversed: false },
      ],
      context: { tagPropertyDefinitionByOptionId: new Map() },
    });
    expect(captured.isOk()).toBe(true);
    if (captured.isErr()) return;

    const { config, issues } = readTaskSavedView(captured.value);
    expect(issues).toEqual([]);
    expect(config.layout).toBe('gantt');
    expect(config.groupBy).toBe('project');
    expect(config.sort).toEqual([
      { id: 'created_at', reversed: true },
      { id: 'viewed_at', reversed: false },
    ]);
    const restored = materializeTaskSavedView(config);
    expect(restored.layout).toBe('gantt');
    expect(restored.groupBy).toBe('project');
    expect(buildTaskQuery({ ...options, ...restored }).groupBy).toEqual({
      type: 'project',
    });
    expect(restored.sort).toEqual(config.sort);
    expect(
      buildTaskQuery({ ...options, ...restored, groupBy: 'none' }).params
    ).toMatchObject({ sort_method: 'created_at', sort_direction: 'asc' });
  });

  it('uses the first saved sort and its direction rather than later sorts', () => {
    const { config } = readTaskSavedView({
      kind: 'tasks',
      version: 1,
      filters: {
        statusOptionIds: [],
        priorityOptionIds: [],
        assignees: [],
        creators: [],
        tags: [],
      },
      layout: 'board',
      sort: [
        { id: 'viewed_at', reversed: false },
        { id: 'created_at', reversed: true },
      ],
    });
    const restored = materializeTaskSavedView(config);
    expect(restored.layout).toBe('board');
    expect(
      buildTaskQuery({ ...options, ...restored, groupBy: 'none' }).params
    ).toMatchObject({ sort_method: 'viewed_at', sort_direction: 'desc' });
  });

  it('keeps supported filters and sorts when future presentation settings are malformed', () => {
    const status = '30000000-0000-4000-8000-000000000001';
    const { config, issues } = readTaskSavedView({
      kind: 'tasks',
      version: 1,
      filters: {
        statusOptionIds: [status],
        priorityOptionIds: [],
        assignees: [],
        creators: [],
        tags: [],
      },
      layout: 'timeline',
      groupBy: 'future_group',
      sort: [
        { id: 'future_sort', reversed: true },
        { id: 'created_at', reversed: true },
        { id: 'viewed_at', reversed: 'yes' },
      ],
    });
    expect(issues.map(({ path }) => path.join('.'))).toEqual(
      expect.arrayContaining([
        'layout',
        'groupBy',
        'sort.0.id',
        'sort.2.reversed',
      ])
    );
    const restored = materializeTaskSavedView(config);
    expect(restored.layout).toBe('list');
    expect(restored.groupBy).toBe('priority');
    expect(restored.sort).toEqual([{ id: 'created_at', reversed: true }]);
    expect(restored.facets.status).toEqual([status]);
    const query = buildTaskQuery({ ...options, ...restored, groupBy: 'none' });
    expect(JSON.stringify(query.body.propf)).toContain(status);
    expect(query.params).toMatchObject({
      sort_method: 'created_at',
      sort_direction: 'asc',
    });
  });

  it('defaults missing optional layout, grouping, and sort settings', () => {
    const saved = {
      kind: 'tasks',
      version: 1,
      filters: {
        statusOptionIds: [],
        priorityOptionIds: [],
        assignees: [],
        creators: [],
        tags: [],
      },
    };
    const decoded = decodeTaskSavedView(saved);
    expect(decoded.isOk()).toBe(true);
    const { config, issues } = readTaskSavedView(saved);
    expect(issues).toEqual([]);
    expect(config.layout).toBe('list');
    expect(config.groupBy).toBe('priority');
    expect(config.sort).toEqual([{ id: 'updated_at', reversed: false }]);
    expect(materializeTaskSavedView(config)).toMatchObject({
      layout: 'list',
      groupBy: 'priority',
      sort: [{ id: 'updated_at', reversed: false }],
    });
  });
});

describe('saved task filter execution', () => {
  it('captures built-in person restrictions as OR filters for each viewer', () => {
    for (const { tab, facets } of [
      {
        tab: 'my-tasks' as const,
        facets: { assignees: ['macro|fixed@example.com'] },
      },
      {
        tab: 'created-by-me' as const,
        facets: { 'created-by': ['macro|fixed@example.com'] },
      },
    ]) {
      const captured = captureTaskSavedView({
        tab,
        facets,
        context: { tagPropertyDefinitionByOptionId: new Map() },
      });
      expect(captured.isOk()).toBe(true);
      if (captured.isErr()) continue;
      const restored = materializeTaskSavedView(captured.value);
      for (const viewer of ['macro|a@example.com', 'macro|b@example.com']) {
        const query = buildTaskQuery({
          ...options,
          ...restored,
          userId: viewer,
        });
        const search = buildTaskSearchRequest({
          ...restored,
          query: 'review',
          matchType: 'partial',
          userId: viewer,
        });
        if (tab === 'my-tasks') {
          expect(query.body.df).toEqual({ l: { dst: 'task' } });
          expect(query.body.propf).toEqual({
            '|': [
              {
                l: {
                  pd: '00000001-0000-0000-0000-000000000001',
                  v: { er: viewer },
                },
              },
              {
                l: {
                  pd: '00000001-0000-0000-0000-000000000001',
                  v: { er: 'macro|fixed@example.com' },
                },
              },
            ],
          });
          expect(
            search.body.filters?.property_filters?.[0]?.entity_ids
          ).toEqual(['macro|fixed@example.com', viewer]);
        } else {
          expect(query.body.df).toEqual({
            '&': [
              { l: { dst: 'task' } },
              {
                '|': [
                  { l: { o: viewer } },
                  { l: { o: 'macro|fixed@example.com' } },
                ],
              },
            ],
          });
          expect(search.body.filters?.document_filters?.owners).toEqual([
            'macro|fixed@example.com',
            viewer,
          ]);
        }
      }
    }
  });
  it('applies supported saved filters while omitting malformed entries and conflicting bindings', () => {
    const { config, issues } = readTaskSavedView({
      kind: 'tasks',
      version: 1,
      filters: {
        statusOptionIds: ['invalid'],
        priorityOptionIds: [],
        assignees: [{ type: 'viewer' }, { type: 'robot' }],
        creators: [],
        tags: [
          {
            optionId: '20000000-0000-4000-8000-000000000001',
            propertyDefinitionId: '10000000-0000-4000-8000-000000000001',
          },
          {
            optionId: '20000000-0000-4000-8000-000000000001',
            propertyDefinitionId: '10000000-0000-4000-8000-000000000002',
          },
        ],
        futureFilter: ['unsupported'],
      },
    });
    const restored = materializeTaskSavedView(config);
    const query = buildTaskQuery({ ...options, ...restored });
    const search = buildTaskSearchRequest({
      ...restored,
      userId: 'user',
      query: 'review',
      matchType: 'partial',
    });
    expect(query.body.df).toEqual({ l: { dst: 'task' } });
    expect(query.body.propf).toEqual({
      l: { pd: '00000001-0000-0000-0000-000000000001', v: { er: 'user' } },
    });
    expect(search.body.filters?.property_filters?.[0]?.entity_ids).toEqual([
      'user',
    ]);
    expect(config.filters.tags).toEqual([]);
    expect(issues.map(({ path }) => path.join('.'))).toEqual(
      expect.arrayContaining([
        'filters.statusOptionIds.0',
        'filters.assignees.1.type',
        'filters.tags.0',
        'filters.tags.1',
        'filters.futureFilter',
      ])
    );
  });

  it.each([
    null,
    {
      kind: 'tasks',
      version: 99,
      filters: { assignees: [{ type: 'viewer' }] },
    },
    {
      kind: 'tasks',
      version: 1,
      filters: {
        statusOptionIds: ['invalid'],
        priorityOptionIds: [],
        assignees: [{ type: 'robot' }],
        creators: [],
        tags: [],
      },
    },
  ])(
    'shows unfiltered tasks when no saved filters can be applied: %j',
    (value) => {
      const { config, issues } = readTaskSavedView(value);
      const restored = materializeTaskSavedView(config);
      const query = buildTaskQuery({ ...options, ...restored });
      expect(query.body.df).toEqual({ l: { dst: 'task' } });
      expect(query.body.propf).toBeUndefined();
      expect(Object.values(restored.facets).flat()).toEqual([]);
      expect(issues.length).toBeGreaterThan(0);
    }
  );

  it('resolves relative people separately for every viewer in lists and searches', () => {
    for (const viewer of ['macro|a@example.com', 'macro|b@example.com']) {
      const facets = { assignees: ['@viewer'], 'created-by': ['@viewer'] };
      const query = buildTaskQuery({ ...options, userId: viewer, facets });
      const search = buildTaskSearchRequest({
        query: 'review',
        matchType: 'partial',
        tab: 'team-tasks',
        userId: viewer,
        facets,
      });
      expect(query.body.propf).toEqual({
        l: { pd: '00000001-0000-0000-0000-000000000001', v: { er: viewer } },
      });
      expect(search.body.filters?.document_filters?.owners).toEqual([viewer]);
      expect(search.body.filters?.property_filters?.[0]?.entity_ids).toEqual([
        viewer,
      ]);
    }
  });

  it('keeps stored tag and unknown status clauses when viewer metadata is unavailable', () => {
    const tag = '20000000-0000-4000-8000-000000000001';
    const property = '10000000-0000-4000-8000-000000000001';
    const status = '30000000-0000-4000-8000-000000000001';
    const facets = { tags: [tag], status: [status] };
    const facetContext = {
      tagPropertyDefinitionByOptionId: new Map([[tag, property]]),
    };
    const query = buildTaskQuery({ ...options, facets, facetContext });
    const search = buildTaskSearchRequest({
      query: 'review',
      matchType: 'partial',
      tab: 'team-tasks',
      userId: 'viewer',
      facets,
      facetContext,
    });
    expect(JSON.stringify(query.body.propf)).toContain(tag);
    expect(JSON.stringify(query.body.propf)).toContain(property);
    expect(JSON.stringify(query.body.propf)).toContain(status);
    expect(search.body.filters?.tag_option_ids).toEqual([tag]);
    expect(search.body.filters?.property_filters?.[0]?.option_ids).toEqual([
      status,
    ]);
  });
});
