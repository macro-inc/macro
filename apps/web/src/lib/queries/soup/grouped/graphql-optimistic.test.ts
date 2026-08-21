import type {
  CacheHost,
  CacheReadArgs,
  InspectQueryVariantsArgs,
} from '@graphql-cache/host/types';
import { describe, expect, it, vi } from 'vitest';
import { registerGroupedSoupContinuation } from './graphql-operation-registry';
import { buildOptimisticGroupedPropertyUpdates } from './graphql-optimistic';

function initialInput(propertyDefinitionId: string) {
  return {
    initial: {
      groupBy: {
        field: 'PROPERTY' as const,
        propertyDefinitionId,
      },
      limit: 20,
    },
  };
}

function continuationInput(propertyDefinitionId: string) {
  return {
    continuation: {
      groupBy: {
        field: 'PROPERTY' as const,
        propertyDefinitionId,
      },
      groupKey: 'in-progress',
      cursor: 'cursor-1',
    },
  };
}

const input = initialInput('status-def');
const continuation = continuationInput('status-def');

function host(args?: {
  destination?: boolean;
  includeUnrelated?: boolean;
  continuation?: boolean;
  initialContainsItem?: boolean;
  miss?: boolean;
  onDiscover?: (propertyDefinitionIds: string[]) => void;
  onInspect?: (request: InspectQueryVariantsArgs) => void;
  onRead?: (request: CacheReadArgs) => void;
  relevantPropertyDefinitionId?: string;
  sourceKey?: string;
  typename?: 'GraphqlSoupCall' | 'GraphqlSoupDocument';
  unrelatedPropertyDefinitionIds?: readonly string[];
}): CacheHost {
  const value = (containsItem: boolean) => ({
    bins: [
      {
        key: args?.sourceKey ?? 'in-progress',
        totalCount: 1,
        nextCursor: null,
        items: containsItem
          ? [
              {
                __typename: args?.typename ?? 'GraphqlSoupDocument',
                id: 'task-1',
              },
            ]
          : [],
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
  const relevantPropertyDefinitionId =
    args?.relevantPropertyDefinitionId ?? 'status-def';
  const relevantInput = initialInput(relevantPropertyDefinitionId);
  const relevantContinuation = continuationInput(relevantPropertyDefinitionId);
  const instances: Array<{
    variables: {
      input:
        | ReturnType<typeof initialInput>
        | ReturnType<typeof continuationInput>;
    };
    value?: ReturnType<typeof value>;
  }> = [
    {
      variables: { input: relevantInput },
      ...(args?.miss
        ? {}
        : { value: value(args?.initialContainsItem !== false) }),
    },
  ];
  if (args?.continuation) {
    instances.push({
      variables: { input: relevantContinuation },
      value: value(true),
    });
  }
  const unrelatedPropertyDefinitionIds = [
    ...(args?.includeUnrelated ? ['priority-def'] : []),
    ...(args?.unrelatedPropertyDefinitionIds ?? []),
  ];
  for (const propertyDefinitionId of unrelatedPropertyDefinitionIds) {
    instances.push({
      variables: { input: initialInput(propertyDefinitionId) },
      value: value(true),
    });
  }

  return {
    clientId: 'test',
    async inspectQueryVariants(request: InspectQueryVariantsArgs) {
      args?.onInspect?.(request);
      args?.onDiscover?.(
        instances.map(({ variables }) => {
          const page =
            'initial' in variables.input
              ? variables.input.initial
              : variables.input.continuation;
          return String(page.groupBy.propertyDefinitionId);
        })
      );
      return instances.map(({ variables }) => ({ variables }));
    },
    async readQuery(request: CacheReadArgs) {
      args?.onRead?.(request);
      const instance = instances.find(
        ({ variables }) =>
          JSON.stringify(variables) === JSON.stringify(request.variables)
      );
      if (!instance?.value) return { kind: 'miss' as const };
      return {
        kind: 'hit' as const,
        data: { user: { groupSoup: instance.value } },
      };
    },
  } as unknown as CacheHost;
}

describe('buildOptimisticGroupedPropertyUpdates', () => {
  it('builds source removal then destination prepend for a status move', async () => {
    const onInspect = vi.fn();
    const onRead = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ includeUnrelated: true, onInspect, onRead }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates).toHaveLength(2);
    expect(result.updates.map((patch) => patch.operation)).toEqual([
      {
        kind: 'removeEmbeddedLink',
        listItem: { whereField: 'key', equals: 'in-progress' },
        linkField: 'items',
        countField: 'totalCount',
        entityKey: 'GraphqlSoupDocument:task-1',
      },
      {
        kind: 'upsertEmbeddedLink',
        listItem: { whereField: 'key', equals: 'completed' },
        linkField: 'items',
        countField: 'totalCount',
        entityKey: 'GraphqlSoupDocument:task-1',
        insertFields: { nextCursor: null },
      },
    ]);
    expect(result.updates.map((update) => update.path)).toEqual([
      [{ field: 'user' }, { field: 'groupSoup' }, { field: 'bins' }],
      [{ field: 'user' }, { field: 'groupSoup' }, { field: 'bins' }],
    ]);
    expect(result.revalidations).toHaveLength(1);
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: 'GroupSoupMembership',
        path: [{ field: 'user' }, { field: 'groupSoup' }],
      })
    );
    expect(onInspect.mock.calls[0]?.[0]).not.toHaveProperty('variableFilters');
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { input },
        priority: 'user-visible',
      })
    );
  });

  it('discovers unrelated status, assignee, and priority variants without reading them', async () => {
    const onDiscover = vi.fn();
    const onRead = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({
        onDiscover,
        onRead,
        relevantPropertyDefinitionId: 'target-def',
        unrelatedPropertyDefinitionIds: [
          'status-def',
          'assignee-def',
          'priority-def',
        ],
      }),
      entityId: 'task-1',
      propertyDefinitionId: 'target-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates).toHaveLength(2);
    expect(onDiscover).toHaveBeenCalledWith([
      'target-def',
      'status-def',
      'assignee-def',
      'priority-def',
    ]);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(
      onRead.mock.calls.map(
        ([request]) =>
          request.variables.input.initial.groupBy.propertyDefinitionId
      )
    ).toEqual(['target-def']);
  });

  it('derives the normalized key from the inspected typename and id', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ typename: 'GraphqlSoupCall' }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates.map((patch) => patch.operation)).toEqual([
      expect.objectContaining({
        kind: 'removeEmbeddedLink',
        entityKey: 'GraphqlSoupCall:task-1',
      }),
      expect.objectContaining({
        kind: 'upsertEmbeddedLink',
        entityKey: 'GraphqlSoupCall:task-1',
      }),
    ]);
  });

  it('creates a missing destination bin as part of the move', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ destination: false }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates).toHaveLength(2);
    expect(result.updates.map((patch) => patch.operation)).toEqual([
      {
        kind: 'removeEmbeddedLink',
        listItem: { whereField: 'key', equals: 'in-progress' },
        linkField: 'items',
        countField: 'totalCount',
        entityKey: 'GraphqlSoupDocument:task-1',
      },
      {
        kind: 'upsertEmbeddedLink',
        listItem: { whereField: 'key', equals: 'completed' },
        linkField: 'items',
        countField: 'totalCount',
        entityKey: 'GraphqlSoupDocument:task-1',
        insertFields: { nextCursor: null },
      },
    ]);
    expect(result.updates[1]?.path).toEqual([
      { field: 'user' },
      { field: 'groupSoup' },
      { field: 'bins' },
    ]);
    expect(result.revalidations).toHaveLength(1);
  });

  it('removes from a registered continuation and prepends to its initial page', async () => {
    registerGroupedSoupContinuation(input, continuation);
    const onRead = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({
        continuation: true,
        initialContainsItem: false,
        onRead,
      }),
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
    ).toEqual([continuation, input]);
    expect(
      onRead.mock.calls.map(([request]) => request.variables.input)
    ).toEqual([input, continuation]);
    expect(result.updates.map((patch) => patch.operation.kind)).toEqual([
      'removeEmbeddedLink',
      'upsertEmbeddedLink',
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
      'removeEmbeddedLink',
      'upsertEmbeddedLink',
    ]);
  });

  it('prepends an addition-only multi-value change from an existing group', async () => {
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ sourceKey: 'shared' }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['shared'],
      newGroupKeys: ['shared', 'completed'],
    });

    expect(result.updates.map((patch) => patch.operation)).toEqual([
      {
        kind: 'upsertEmbeddedLink',
        listItem: { whereField: 'key', equals: 'completed' },
        linkField: 'items',
        countField: 'totalCount',
        entityKey: 'GraphqlSoupDocument:task-1',
        insertFields: { nextCursor: null },
      },
    ]);
  });

  it('revalidates a relevant cached variant whose complete query is a miss', async () => {
    const onRead = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ miss: true, onRead }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });

    expect(result.updates).toEqual([]);
    expect(result.revalidations).toHaveLength(1);
    expect(result.revalidations[0]?.variables).toEqual({ input });
    expect(onRead).toHaveBeenCalledOnce();
  });

  it('skips inspection when group-key sets are equivalent', async () => {
    const onInspect = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ onInspect }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress', 'in-progress'],
      newGroupKeys: ['in-progress'],
    });

    expect(result).toEqual({ updates: [], revalidations: [] });
    expect(onInspect).not.toHaveBeenCalled();
  });

  it('returns revalidation only for unsupported values', async () => {
    const onRead = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({ onRead }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: [],
      newGroupKeys: [],
      revalidateOnly: true,
    });

    expect(result.updates).toEqual([]);
    expect(result.revalidations).toHaveLength(1);
    expect(onRead).not.toHaveBeenCalled();
  });
});
