import type { CacheHost, CacheReadArgs } from '@graphql-cache/host/types';
import type { CacheFieldInfo } from '@graphql-cache/protocol';
import { describe, expect, it } from 'vitest';
import { registerGroupedSoupContinuation } from './graphql-operation-registry';
import { buildOptimisticGroupedPropertyLinkPatches } from './graphql-optimistic';

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
      entityKey: 'GraphqlUser:user-1',
      fieldName: 'groupSoup',
      fieldKey: 'groupSoup(status)',
      arguments: { input },
    },
  ];
  if (args?.continuation) {
    fields.push({
      entityKey: 'GraphqlUser:user-1',
      fieldName: 'groupSoup',
      fieldKey: 'groupSoup(continuation)',
      arguments: { input: continuationInput },
    });
  }
  if (args?.includeUnrelated) {
    fields.push({
      entityKey: 'GraphqlUser:user-1',
      fieldName: 'groupSoup',
      fieldKey: 'groupSoup(priority)',
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

describe('buildOptimisticGroupedPropertyLinkPatches', () => {
  it('builds source removal then destination prepend for a status move', async () => {
    const result = await buildOptimisticGroupedPropertyLinkPatches({
      host: host({ includeUnrelated: true }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.patches).toHaveLength(2);
    expect(result.patches.map((patch) => patch.operation)).toEqual([
      { kind: 'remove', entityKey: 'GraphqlSoupItem:task-1' },
      { kind: 'prependUnique', entityKey: 'GraphqlSoupItem:task-1' },
    ]);
    expect(result.patches.map((patch) => patch.fieldKey)).toEqual([
      'groupSoup(status)',
      'groupSoup(status)',
    ]);
    expect(result.revalidations).toHaveLength(1);
  });

  it('does not make a partial move when the destination bin is absent', async () => {
    const result = await buildOptimisticGroupedPropertyLinkPatches({
      host: host({ destination: false }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.patches).toEqual([]);
    expect(result.revalidations).toHaveLength(1);
  });

  it('removes from a registered continuation and prepends to its initial page', async () => {
    registerGroupedSoupContinuation(input, continuationInput);
    const result = await buildOptimisticGroupedPropertyLinkPatches({
      host: host({ continuation: true, initialContainsItem: false }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.patches.map((patch) => patch.fieldKey)).toEqual([
      'groupSoup(continuation)',
      'groupSoup(status)',
    ]);
    expect(result.patches.map((patch) => patch.operation.kind)).toEqual([
      'remove',
      'prependUnique',
    ]);
  });

  it('uses set differences for multi-value changes', async () => {
    const result = await buildOptimisticGroupedPropertyLinkPatches({
      host: host(),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress', 'shared'],
      newGroupKeys: ['shared', 'completed'],
    });

    expect(result.patches.map((patch) => patch.operation.kind)).toEqual([
      'remove',
      'prependUnique',
    ]);
  });

  it('returns revalidation only for unsupported values', async () => {
    const result = await buildOptimisticGroupedPropertyLinkPatches({
      host: host(),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: [],
      newGroupKeys: [],
      revalidateOnly: true,
    });

    expect(result.patches).toEqual([]);
    expect(result.revalidations).toHaveLength(1);
  });
});
