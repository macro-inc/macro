import { createTagFacetContext } from '@app/features/soup';
import { makeGraphqlFilters } from '@queries/soup/graphql/ast';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { describe, expect, it, vi } from 'vitest';
import {
  createDateBucketBoundaries,
  taskDueDatePredicate,
} from '../core/task-due-date';
import { taskMatchesTab, taskMatchesView } from '../filters/task-predicates';
import { boardEntity, boardProperty } from '../tests/task-board-fixture';
import { buildTaskQuery } from './task-query';
import { buildTaskSearchRequest } from './task-search';

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
  ...(await import('@entity/utils/task-properties')),
  ...(await import('@entity/utils/company-properties')),
}));
vi.mock('@notifications', async () => await import('@notifications/types'));

// The soup barrel these pull in transitively imports the websocket client
// modules, which open real sockets at module scope and reject under jsdom.
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

const TAG_SETS = [
  {
    scope: 'user',
    definition: { id: 'tag-definition' },
    options: [
      {
        id: 'urgent',
        propertyDefinitionId: 'tag-definition',
        displayOrder: 0,
        value: { type: 'string', value: 'Urgent' },
      },
    ],
  },
] as TagSetResponse[];

const requestFor = (facets: Record<string, string[]>, withTagSets = true) => {
  const { body } = buildTaskSearchRequest({
    query: 'launch',
    matchType: 'partial',
    tab: 'team-tasks',
    userId: 'user-1',
    facets,
    facetContext: withTagSets ? createTagFacetContext(TAG_SETS) : undefined,
  });
  return body.filter_expression;
};

describe('buildTaskSearchRequest', () => {
  it('sends selected tags through the same property expression as the list', () => {
    expect(requestFor({ tags: ['urgent', 'urgent'] })).toMatchObject({
      propertiesFilter: {
        literal: {
          propertyDefinitionId: 'tag-definition',
          value: { selectOption: 'urgent' },
        },
      },
    });
  });

  it('drops unavailable tags like the list query', () => {
    expect(requestFor({ tags: ['urgent', 'deleted-tag'] })).toEqual(
      requestFor({ tags: ['urgent'] })
    );
    expect(requestFor({ tags: ['deleted-tag'] }, false)).toMatchObject({
      propertiesFilter: undefined,
    });
  });
});

it('matches assigned-only, created-only, overlapping, and unrelated tasks', () => {
  for (const [ownerId, assigned, expected] of [
    ['someone-else', true, true],
    ['viewer', false, true],
    ['viewer', true, true],
    ['someone-else', false, false],
  ] as const) {
    const task = {
      ...boardEntity(
        'task',
        assigned
          ? [
              boardProperty('00000001-0000-0000-0000-000000000001', {
                type: 'EntityReference',
                value: [{ entity_type: 'USER', entity_id: 'viewer' }],
              }),
            ]
          : []
      ),
      ownerId,
    };
    expect(taskMatchesTab(task, 'my-tasks', 'viewer')).toBe(expected);
    expect(taskMatchesTab(task, 'my-tasks', undefined)).toBe(false);
  }
});

it('compiles the same DST range for remote and local search without changing text ordering', () => {
  const calendar = createDateBucketBoundaries(
    new Date('2026-03-08T17:00:00Z'),
    'America/New_York'
  );
  const dueDate = taskDueDatePredicate({ type: 'today' }, calendar);
  const request = buildTaskSearchRequest({
    query: 'launch',
    matchType: 'partial',
    tab: 'team-tasks',
    userId: 'user',
    facets: {},
    dueDate,
  });
  expect(request.body.filter_expression).toMatchObject({
    propertiesFilter: {
      literal: {
        propertyDefinitionId: '00000001-0000-0000-0000-000000000004',
        entityType: 'TASK',
        value: {
          dateRange: {
            start: '2026-03-08T05:00:00.000Z',
            end: '2026-03-09T04:00:00.000Z',
          },
        },
      },
    },
  });
  expect(request.body).not.toHaveProperty('sort');
  const context = {
    tab: 'team-tasks' as const,
    userId: 'user',
    facets: {},
    dueDate,
  };
  expect(taskMatchesView(boardEntity('missing'), context)).toBe(false);
  expect(
    taskMatchesView(
      boardEntity('today', [
        boardProperty(
          '00000001-0000-0000-0000-000000000004',
          { type: 'Date', value: '2026-03-09T03:59:59Z' },
          'DATE'
        ),
      ]),
      context
    )
  ).toBe(true);
  expect(
    taskMatchesView(
      boardEntity('tomorrow', [
        boardProperty(
          '00000001-0000-0000-0000-000000000004',
          { type: 'Date', value: '2026-03-09T04:00:00Z' },
          'DATE'
        ),
      ]),
      context
    )
  ).toBe(false);
});

it('sends explicit false presence rather than omitting the no-date filter', () => {
  const request = buildTaskSearchRequest({
    query: 'launch',
    matchType: 'partial',
    tab: 'team-tasks',
    userId: 'user',
    facets: {},
    dueDate: { hasDate: false },
  });
  expect(request.body.filter_expression).toMatchObject({
    propertiesFilter: {
      not: {
        literal: {
          propertyDefinitionId: '00000001-0000-0000-0000-000000000004',
          entityType: 'TASK',
          value: { dateRange: {} },
        },
      },
    },
  });
});

it.each(['my-tasks', 'team-tasks'] as const)(
  'uses the list expression for %s with all refinements',
  (tab) => {
    const options = {
      tab,
      userId: 'macro|viewer@example.com',
      facets: {
        assignees: ['macro|colleague@example.com'],
        'created-by': ['macro|creator@example.com'],
        tags: ['urgent'],
      },
      facetContext: createTagFacetContext(TAG_SETS),
      reference: {
        propertyDefinitionId: '00000001-0000-0000-0000-000000000014',
        entityId: '10000000-0000-0000-0000-000000000001',
      },
      dueDate: { hasDate: false } as const,
    };
    const list = makeGraphqlFilters(
      buildTaskQuery({
        ...options,
        groupBy: 'none',
        sort: [{ id: 'updated_at' }],
      }).body
    );
    const search = buildTaskSearchRequest({
      ...options,
      query: 'launch',
      matchType: 'partial',
    });
    expect(search.body.filter_expression).toEqual({
      documentFilter: list.documentFilter,
      propertiesFilter: list.propertiesFilter,
    });
    expect(search.body.filters?.document_filters).toEqual({
      sub_types: ['task'],
    });
    expect(
      search.body.filters?.calendar_event_filters?.calendar_event_ids
    ).toEqual(['00000000-0000-0000-0000-000000000000']);
    expect(search.body.query).toBe('launch');
  }
);
