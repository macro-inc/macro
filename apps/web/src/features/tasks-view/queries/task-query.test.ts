import { describe, expect, it, vi } from 'vitest';
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

it('uses the initiative Project property for board columns without changing legacy list grouping', () => {
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
