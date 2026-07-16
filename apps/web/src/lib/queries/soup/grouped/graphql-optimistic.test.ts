import type { CacheHost, CacheReadArgs } from '@graphql-cache/host/types';
import type { CacheFieldInfo } from '@graphql-cache/protocol';
import { describe, expect, it } from 'vitest';
import { registerGroupedSoupContinuation } from './graphql-operation-registry';
import { buildOptimisticGroupedPropertyUpdates } from './graphql-optimistic';

const input = {
  initial: {
    groupBy: {
      field: 'PROPERTY' as const,
      propertyDefinitionId: 'status-def',
    },
    limit: 20,
  },
};

const continuationInput = {
  continuation: {
    groupBy: {
      field: 'PROPERTY' as const,
      propertyDefinitionId: 'status-def',
    },
    groupKey: 'in-progress',
    cursor: 'cursor-1',
  },
};

function host(args?: {
  destination?: boolean;
  includeUnrelated?: boolean;
  continuation?: boolean;
  initialContainsItem?: boolean;
}): CacheHost {
  const fields: CacheFieldInfo[] = [
    {
      fieldName: 'groupSoup',
      arguments: { input },
    },
  ];
  if (args?.continuation) {
    fields.push({
      fieldName: 'groupSoup',
      arguments: { input: continuationInput },
    });
  }
  if (args?.includeUnrelated) {
    fields.push({
      fieldName: 'groupSoup',
      arguments: {
        input: {
          initial: {
            groupBy: {
              field: 'PROPERTY',
              propertyDefinitionId: 'priority-def',
            },
            limit: 20,
          },
        },
      },
    });
  }

  return {
    clientId: 'test',
    async readQuery(request: CacheReadArgs) {
      if (request.operationName === 'OptimisticGroupSoupViewer') {
        return { kind: 'hit', data: { user: { id: 'user-1' } } };
      }
      const requestedInput = request.variables?.input as
        | typeof input
        | typeof continuationInput
        | undefined;
      const continuation = requestedInput && 'continuation' in requestedInput;
      const containsItem = continuation || args?.initialContainsItem !== false;
      return {
        kind: 'hit',
        data: {
          user: {
            id: 'user-1',
            groupSoup: {
              bins: [
                {
                  key: 'in-progress',
                  totalCount: 1,
                  nextCursor: null,
                  items: containsItem ? [{ id: 'task-1' }] : [],
                },
                ...(args?.destination === false
                  ? []
                  : [
                      {
                        key: 'completed',
                        totalCount: 0,
                        nextCursor: null,
                        items: [],
                      },
                    ]),
              ],
            },
          },
        },
      };
    },
    async inspectFields() {
      return fields;
    },
  } as unknown as CacheHost;
}

describe('buildOptimisticGroupedPropertyUpdates', () => {
  it('builds source removal then destination prepend for a status move', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ includeUnrelated: true }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates).toHaveLength(2);
    expect(result.updates.map((patch) => patch.operation)).toEqual([
      { kind: 'remove', entityKey: 'GraphqlSoupItem:task-1' },
      { kind: 'prependUnique', entityKey: 'GraphqlSoupItem:task-1' },
    ]);
    expect(result.updates.map((update) => update.path)).toEqual([
      [
        { field: 'user' },
        { field: 'groupSoup' },
        { field: 'bins' },
        { listItem: { whereField: 'key', equals: 'in-progress' } },
        { field: 'items' },
      ],
      [
        { field: 'user' },
        { field: 'groupSoup' },
        { field: 'bins' },
        { listItem: { whereField: 'key', equals: 'completed' } },
        { field: 'items' },
      ],
    ]);
    expect(result.revalidations).toHaveLength(1);
  });

  it('does not make a partial move when the destination bin is absent', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ destination: false }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates).toEqual([]);
    expect(result.revalidations).toHaveLength(1);
  });

  it('removes from a registered continuation and prepends to its initial page', async () => {
    registerGroupedSoupContinuation(input, continuationInput);
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ continuation: true, initialContainsItem: false }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(
      result.updates.map(
        (update) =>
          (JSON.parse(update.variablesJson) as { input: unknown }).input
      )
    ).toEqual([continuationInput, input]);
    expect(result.updates.map((patch) => patch.operation.kind)).toEqual([
      'remove',
      'prependUnique',
    ]);
  });

  it('uses set differences for multi-value changes', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host(),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress', 'shared'],
      newGroupKeys: ['shared', 'completed'],
    });

    expect(result.updates.map((patch) => patch.operation.kind)).toEqual([
      'remove',
      'prependUnique',
    ]);
  });

  it('returns revalidation only for unsupported values', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host(),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: [],
      newGroupKeys: [],
      revalidateOnly: true,
    });

    expect(result.updates).toEqual([]);
    expect(result.revalidations).toHaveLength(1);
  });
});
