import type { CacheHost } from '@graphql-cache/host/types';
import { describe, expect, it, vi } from 'vitest';
import { buildPropertyAssignmentLinks } from './assignment-links';

function host(flat: unknown[], grouped: unknown[] = []) {
  return {
    inspectQuery: vi.fn(async (args: { operationName?: string }) =>
      args.operationName === 'SoupMembership' ? flat : grouped
    ),
  } as unknown as CacheHost;
}

describe('new property assignment links', () => {
  it('links one flat-list parent by ID and reconciles by definition, not temporary ID', async () => {
    const cache = host([
      {
        variables: { input: { initial: { limit: 10 } } },
        value: { items: [{ id: 'other' }] },
      },
      {
        variables: { input: { initial: { limit: 20 } } },
        value: { items: [{ id: 'task-1' }] },
      },
    ]);
    const patches = await buildPropertyAssignmentLinks(
      cache,
      'task-1',
      'temporary-1',
      'priority'
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      operationName: 'EntityProperties',
      path: [
        { field: 'user' },
        { field: 'soup' },
        { field: 'items' },
        { listItem: { whereField: 'id', equals: 'task-1' } },
        { field: 'properties' },
      ],
      operation: {
        kind: 'upsertByField',
        entityKey: 'GraphqlProperty:temporary-1',
        whereField: 'propertyDefinitionId',
        equals: 'priority',
      },
    });
    expect(JSON.parse(patches[0].variablesJson)).toEqual({
      input: { initial: { limit: 20 } },
    });
    expect(cache.inspectQuery).toHaveBeenCalledOnce();
  });

  it('finds grouped-only parents without requiring unrelated property data', async () => {
    const cache = host(
      [],
      [
        {
          variables: { input: { initial: { limit: 20 } } },
          value: { bins: [{ key: 'not-set', items: [{ id: 'task-1' }] }] },
        },
      ]
    );
    const patches = await buildPropertyAssignmentLinks(
      cache,
      'task-1',
      'temporary-1',
      'priority'
    );
    expect(patches[0]).toMatchObject({
      operationName: 'GroupEntityProperties',
      path: [
        { field: 'user' },
        { field: 'groupSoup' },
        { field: 'bins' },
        { listItem: { whereField: 'key', equals: 'not-set' } },
        { field: 'items' },
        { listItem: { whereField: 'id', equals: 'task-1' } },
        { field: 'properties' },
      ],
    });
  });

  it('does not manufacture a relation for a parent absent from cached lists', async () => {
    expect(
      await buildPropertyAssignmentLinks(
        host([]),
        'task-1',
        'temporary-1',
        'priority'
      )
    ).toEqual([]);
  });
});
