import type {
  CacheHost,
  CacheReadArgs,
  InspectQueryVariantsArgs,
} from '@graphql-cache/host/types';
import {
  GroupSoupDocument,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { registerGraphqlSoupRevalidations } from '../graphql/active-queries';
import { registerGroupedSoupContinuation } from './graphql-operation-registry';
import {
  buildOptimisticGroupedPropertyUpdates,
  createGroupedPropertyPreparation,
} from './graphql-optimistic';

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
  active?: () => boolean;
  register?: boolean;
  onInspect?: (request: InspectQueryVariantsArgs) => void;
  onRead?: (request: CacheReadArgs) => void;
  relevantPropertyDefinitionId?: string;
  sourceKey?: string;
  entityIds?: string[];
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
          ? (args?.entityIds ?? ['task-1']).map((id) => ({
              __typename: args?.typename ?? 'GraphqlSoupDocument',
              id,
            }))
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

  if (args?.register !== false) {
    onTestFinished(
      registerGraphqlSoupRevalidations(() =>
        args?.active?.() === false
          ? []
          : instances.map(({ variables }) => ({
              document: GroupSoupDocument,
              variables,
            }))
      )
    );
  }

  return {
    clientId: 'test',
    async inspectQueryVariants(request: InspectQueryVariantsArgs) {
      args?.onInspect?.(request);
      throw new Error('query inspection variant count 129 exceeds limit 128');
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
    expect(onInspect).not.toHaveBeenCalled();
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { input },
        priority: 'user-visible',
      })
    );
  });

  it('ignores unrelated active status, assignee, and priority views without inspecting the cache', async () => {
    const onInspect = vi.fn();
    const onRead = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({
        onInspect,
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
    expect(onInspect).not.toHaveBeenCalled();
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(
      onRead.mock.calls.map(
        ([request]) =>
          request.variables.input.initial.groupBy.propertyDefinitionId
      )
    ).toEqual(['target-def']);
  });

  it('never visits historical cached pages, even when inspection would exceed its budget', async () => {
    const onRead = vi.fn();
    const onInspect = vi.fn();
    const result = await buildOptimisticGroupedPropertyUpdates({
      host: host({
        register: false,
        onRead,
        onInspect,
        unrelatedPropertyDefinitionIds: Array.from(
          { length: 200 },
          (_, i) => `historical-${i}`
        ),
      }),
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    });
    expect(result).toEqual({ updates: [], revalidations: [] });
    expect(onRead).not.toHaveBeenCalled();
    expect(onInspect).not.toHaveBeenCalled();
  });

  it('deduplicates split readers and drops disabled, changed, and unmounted views', async () => {
    const onRead = vi.fn();
    const cache = host({ register: false, onRead });
    let active = true;
    let currentInput = input;
    const unregister = registerGraphqlSoupRevalidations(() =>
      active
        ? [
            { document: GroupSoupDocument, variables: { input: currentInput } },
            { document: GroupSoupDocument, variables: { input: currentInput } },
            { document: SoupDocument, variables: { input: {} } },
          ]
        : []
    );
    onTestFinished(unregister);
    const prepare = () =>
      buildOptimisticGroupedPropertyUpdates({
        host: cache,
        entityId: 'task-1',
        propertyDefinitionId: 'status-def',
        oldGroupKeys: ['in-progress'],
        newGroupKeys: ['completed'],
      });
    expect((await prepare()).revalidations).toHaveLength(1);
    expect(onRead).toHaveBeenCalledOnce();
    active = false;
    expect(await prepare()).toEqual({ updates: [], revalidations: [] });
    active = true;
    currentInput = initialInput('priority-def');
    expect(await prepare()).toEqual({ updates: [], revalidations: [] });
    currentInput = input;
    unregister();
    expect(await prepare()).toEqual({ updates: [], revalidations: [] });
    expect(onRead).toHaveBeenCalledOnce();
  });

  it('shares reads across a bulk edit but retains each mutation’s durable recovery', async () => {
    const onRead = vi.fn();
    const prepare = createGroupedPropertyPreparation(
      host({ onRead, entityIds: ['task-1', 'task-2'] })
    );
    for (const entityId of ['task-1', 'task-2']) {
      const result = await prepare({
        entityId,
        propertyDefinitionId: 'status-def',
        oldGroupKeys: ['in-progress'],
        newGroupKeys: ['completed'],
      });
      expect(result.updates).toHaveLength(2);
      expect(result.updates[0].operation).toMatchObject({
        entityKey: `GraphqlSoupDocument:${entityId}`,
      });
      expect(result.revalidations).toHaveLength(1);
    }
    expect(onRead).toHaveBeenCalledOnce();
  });

  it('rereads membership for a repeat edit to an entity within a bulk save', async () => {
    const onRead = vi.fn();
    const prepare = createGroupedPropertyPreparation(host({ onRead }));
    const args = {
      entityId: 'task-1',
      propertyDefinitionId: 'status-def',
      oldGroupKeys: ['in-progress'],
      newGroupKeys: ['completed'],
    };
    await prepare(args);
    await prepare(args);
    expect(onRead).toHaveBeenCalledTimes(2);
  });

  it('derives the normalized key from the loaded typename and id', async () => {
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

  it('skips all reads when group-key sets are equivalent', async () => {
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
