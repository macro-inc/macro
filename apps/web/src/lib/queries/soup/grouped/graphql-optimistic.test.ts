import type { CacheHost } from '@graphql-cache/host/types';
import { describe, expect, it, vi } from 'vitest';
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
  miss?: boolean;
  onInspect?: () => void;
  sourceKey?: string;
}): CacheHost {
  const value = (containsItem: boolean) => ({
    bins: [
      {
        key: args?.sourceKey ?? 'in-progress',
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
  });
  const instances: Array<{
    variables: { input: typeof input | typeof continuationInput };
    value?: ReturnType<typeof value>;
  }> = [
    {
      variables: { input },
      ...(args?.miss
        ? {}
        : { value: value(args?.initialContainsItem !== false) }),
    },
  ];
  if (args?.continuation) {
    instances.push({
      variables: { input: continuationInput },
      value: value(true),
    });
  }
  if (args?.includeUnrelated) {
    instances.push({
      variables: {
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
      value: value(true),
    });
  }

  return {
    clientId: 'test',
    async inspectQuery() {
      args?.onInspect?.();
      return instances;
    },
  } as unknown as CacheHost;
}

describe('buildOptimisticGroupedPropertyUpdates', () => {
  it('builds source removal then destination prepend for a status move', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ includeUnrelated: true }),
      entityId: 'task-1',
      entityType: 'DOCUMENT',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates).toHaveLength(2);
    expect(result.updates.map((patch) => patch.operation)).toEqual([
      { kind: 'remove', entityKey: 'GraphqlSoupDocument:task-1' },
      { kind: 'prependUnique', entityKey: 'GraphqlSoupDocument:task-1' },
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
      entityType: 'DOCUMENT',
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
      entityType: 'DOCUMENT',
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
      entityType: 'DOCUMENT',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress', 'shared'],
      newGroupKeys: ['shared', 'completed'],
    });

    expect(result.updates.map((patch) => patch.operation.kind)).toEqual([
      'remove',
      'prependUnique',
    ]);
  });

  it('prepends an addition-only multi-value change from an existing group', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ sourceKey: 'shared' }),
      entityId: 'task-1',
      entityType: 'DOCUMENT',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['shared'],
      newGroupKeys: ['shared', 'completed'],
    });

    expect(result.updates.map((patch) => patch.operation)).toEqual([
      { kind: 'prependUnique', entityKey: 'GraphqlSoupDocument:task-1' },
    ]);
  });

  it('revalidates a relevant cached variant whose complete query is a miss', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ miss: true }),
      entityId: 'task-1',
      entityType: 'DOCUMENT',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates).toEqual([]);
    expect(result.revalidations).toHaveLength(1);
    expect(result.revalidations[0]?.variables).toEqual({ input });
  });

  it('skips inspection when group-key sets are equivalent', async () => {
    const onInspect = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ onInspect }),
      entityId: 'task-1',
      entityType: 'DOCUMENT',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress', 'in-progress'],
      newGroupKeys: ['in-progress'],
    });

    expect(result).toEqual({ updates: [], revalidations: [] });
    expect(onInspect).not.toHaveBeenCalled();
  });

  it('returns revalidation only for unsupported values', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host(),
      entityId: 'task-1',
      entityType: 'DOCUMENT',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: [],
      newGroupKeys: [],
      revalidateOnly: true,
    });

    expect(result.updates).toEqual([]);
    expect(result.revalidations).toHaveLength(1);
  });
});
