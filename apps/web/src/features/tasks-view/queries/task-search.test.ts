import { createTagFacetContext } from '@app/features/soup';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { describe, expect, it, vi } from 'vitest';
import { buildTaskSearchRequest } from './task-search';

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
  if (!body.filters) throw new Error('search request has no filters');

  return body.filters;
};

describe('buildTaskSearchRequest', () => {
  it('sends selected tags as an entity-wide filter', () => {
    const filters = requestFor({ tags: ['urgent', 'urgent'] });

    expect(filters.tag_option_ids).toEqual(['urgent']);
    expect(filters.tag_filter_mode).toBe('any');
  });

  it('drops a selected tag that no longer exists, like the list query', () => {
    expect(
      requestFor({ tags: ['urgent', 'deleted-tag'] }).tag_option_ids
    ).toEqual(['urgent']);

    const unresolved = requestFor({ tags: ['deleted-tag'] }, false);
    expect(unresolved.tag_option_ids).toBeUndefined();
    expect(unresolved.tag_filter_mode).toBeUndefined();
  });
});
