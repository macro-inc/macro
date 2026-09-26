import type { Property, PropertyDefinitionDomain } from '@property/types';
import { validate as validateUuid } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeOptimisticMutationMock = vi.hoisted(() => vi.fn());
const optimisticMutationDispositionOfMock = vi.hoisted(() => vi.fn());
const readRecordsByKeysMock = vi.hoisted(() => vi.fn());
const cacheHostState = vi.hoisted(() => ({ current: {} as unknown }));

vi.mock('@graphql-cache/index', () => ({
  executeOptimisticMutation: executeOptimisticMutationMock,
  optimisticMutationDispositionOf: optimisticMutationDispositionOfMock,
  readRecordsByKeys: readRecordsByKeysMock,
  selectRecords: () => ({}),
  prependUnique: (entity: { __typename: string; id: string }) => ({
    kind: 'prependUnique',
    entity,
  }),
  updateEntityLinks: (
    entity: { __typename: string; id: string },
    field: string,
    operation: { kind: string; entity: { __typename: string; id: string } }
  ) => ({
    recordKey: `${entity.__typename}:${entity.id}`,
    field,
    operation: {
      kind: operation.kind,
      entityKey: `${operation.entity.__typename}:${operation.entity.id}`,
    },
  }),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
  getGraphqlCacheHost: () => cacheHostState.current,
}));

/** Caches `doc-1` carrying `assignments` (definition id → assignment id). */
function cacheEntity(assignments: Record<string, string>) {
  readRecordsByKeysMock.mockResolvedValue({
    revision: {},
    records: [
      {
        recordKey: 'GraphqlSoupDocument:doc-1',
        record: {
          properties: Object.entries(assignments).map(
            ([propertyDefinitionId, id]) => ({ id, propertyDefinitionId })
          ),
        },
      },
    ],
  });
}

vi.mock('./entity', () => ({
  toGraphqlPropertyTargetEntityType: (entityType: string) => entityType,
}));

import { updateGraphqlEntityPropertyOptions } from './entity-options';

const tagDefinition = {
  id: 'tag-def',
  displayName: 'Tags',
  valueType: 'TAG',
  isMultiSelect: true,
  isSystem: false,
  isMetadata: false,
} as unknown as PropertyDefinitionDomain;

const tagProperty = {
  propertyId: 'assignment-1',
  propertyDefinitionId: 'tag-def',
  displayName: 'Tags',
  valueType: 'TAG',
  isMultiSelect: true,
  isSystemProperty: false,
  isMetadata: false,
} as unknown as Property;

function committedWith(optionIds: string[]) {
  return {
    kind: 'committed' as const,
    data: {
      applyEntityPropertyOptionDeltas: {
        properties: [
          {
            propertyDefinitionId: 'tag-def',
            value: {
              __typename: 'GraphqlSelectOptionPropertyValue',
              optionIds,
            },
          },
        ],
        effects: [],
      },
    },
  };
}

function optimisticArgs() {
  const call = executeOptimisticMutationMock.mock.calls[0];
  if (!call) throw new Error('mutation was never executed');
  return { variables: call[2], optimisticData: call[3], options: call[4] };
}

describe('updateGraphqlEntityPropertyOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheHostState.current = {};
    cacheEntity({ 'tag-def': 'assignment-1' });
    executeOptimisticMutationMock.mockReturnValue({
      toPromise: () => Promise.resolve({ data: undefined, error: undefined }),
    });
    optimisticMutationDispositionOfMock.mockReturnValue(
      committedWith(['spotlight'])
    );
  });

  it('sends option deltas and writes the property record optimistically', async () => {
    await expect(
      updateGraphqlEntityPropertyOptions({
        entityType: 'DOCUMENT',
        entityId: 'doc-1',
        properties: [
          {
            property: tagProperty,
            currentOptionIds: ['stale'],
            nextOptionIds: ['spotlight'],
          },
        ],
      })
    ).resolves.toEqual([
      { propertyDefinitionId: 'tag-def', optionIds: ['spotlight'] },
    ]);

    const { variables, optimisticData, options } = optimisticArgs();
    expect(variables).toEqual({
      input: {
        entityType: 'DOCUMENT',
        entityId: 'doc-1',
        properties: [
          {
            propertyDefinitionId: 'tag-def',
            addOptionIds: ['spotlight'],
            removeOptionIds: ['stale'],
          },
        ],
      },
    });
    expect(
      optimisticData.applyEntityPropertyOptionDeltas.properties
    ).toMatchObject([
      {
        id: 'assignment-1',
        propertyDefinitionId: 'tag-def',
        value: {
          __typename: 'GraphqlSelectOptionPropertyValue',
          optionIds: ['spotlight'],
        },
      },
    ]);
    expect(optimisticData.applyEntityPropertyOptionDeltas.effects).toEqual([]);
    expect(options).toEqual({ uuid: expect.any(String), updates: [] });
    expect(validateUuid(options.uuid)).toBe(true);
    expect(readRecordsByKeysMock).toHaveBeenCalledWith(
      cacheHostState.current,
      expect.anything(),
      ['GraphqlSoupDocument:doc-1']
    );
  });

  it('uses a fresh UUID for each non-coalescible delta batch', async () => {
    const input = {
      entityType: 'DOCUMENT' as const,
      entityId: 'doc-1',
      properties: [
        {
          property: tagProperty,
          currentOptionIds: ['stale'],
          nextOptionIds: ['spotlight'],
        },
      ],
    };

    await updateGraphqlEntityPropertyOptions(input);
    await updateGraphqlEntityPropertyOptions(input);

    const uuids = executeOptimisticMutationMock.mock.calls.map(
      (call) => call[4].uuid
    );
    expect(uuids.every(validateUuid)).toBe(true);
    expect(new Set(uuids).size).toBe(2);
  });

  it('links a first tag optimistically under a temporary id', async () => {
    cacheEntity({ 'status-def': 'assignment-9' });

    await updateGraphqlEntityPropertyOptions({
      entityType: 'DOCUMENT',
      entityId: 'doc-1',
      properties: [
        {
          property: tagDefinition,
          currentOptionIds: [],
          nextOptionIds: ['spotlight'],
        },
      ],
    });

    const { variables, optimisticData, options } = optimisticArgs();
    expect(variables.input.properties).toEqual([
      {
        propertyDefinitionId: 'tag-def',
        addOptionIds: ['spotlight'],
        removeOptionIds: [],
      },
    ]);
    const [record] = optimisticData.applyEntityPropertyOptionDeltas.properties;
    expect(validateUuid(record.id)).toBe(true);
    expect(record).toMatchObject({
      propertyDefinitionId: 'tag-def',
      displayName: 'Tags',
      value: {
        __typename: 'GraphqlSelectOptionPropertyValue',
        optionIds: ['spotlight'],
      },
    });
    // The server never writes the temporary record, so settlement drops this
    // link and the response's refreshed entity carries the real assignment.
    expect(options.updates).toEqual([
      {
        recordKey: 'GraphqlSoupDocument:doc-1',
        field: 'properties',
        operation: {
          kind: 'prependUnique',
          entityKey: `GraphqlProperty:${record.id}`,
        },
      },
    ]);
  });

  it('targets the cached assignment over a stale captured id', async () => {
    // An earlier first tag committed after the picker captured its temporary id.
    cacheEntity({ 'tag-def': 'assignment-real' });

    await updateGraphqlEntityPropertyOptions({
      entityType: 'DOCUMENT',
      entityId: 'doc-1',
      properties: [
        {
          property: { ...tagProperty, propertyId: 'temporary-id' } as Property,
          currentOptionIds: ['spotlight'],
          nextOptionIds: ['spotlight', 'roadmap'],
        },
      ],
    });

    const { optimisticData, options } = optimisticArgs();
    expect(
      optimisticData.applyEntityPropertyOptionDeltas.properties
    ).toMatchObject([{ id: 'assignment-real' }]);
    expect(options.updates).toEqual([]);
  });

  it('builds nothing for a removal from an unassigned property', async () => {
    cacheEntity({});

    await updateGraphqlEntityPropertyOptions({
      entityType: 'DOCUMENT',
      entityId: 'doc-1',
      properties: [
        {
          property: tagDefinition,
          currentOptionIds: ['stale'],
          nextOptionIds: [],
        },
      ],
    });

    const { optimisticData, options } = optimisticArgs();
    expect(optimisticData.applyEntityPropertyOptionDeltas.properties).toEqual(
      []
    );
    expect(options.updates).toEqual([]);
  });

  it('falls back to the captured assignment when the cache is unavailable', async () => {
    cacheHostState.current = undefined;

    await updateGraphqlEntityPropertyOptions({
      entityType: 'DOCUMENT',
      entityId: 'doc-1',
      properties: [
        {
          property: tagProperty,
          currentOptionIds: [],
          nextOptionIds: ['spotlight'],
        },
        {
          property: { ...tagDefinition, id: 'label-def' },
          currentOptionIds: [],
          nextOptionIds: ['urgent'],
        },
      ],
    });

    const { optimisticData, options } = optimisticArgs();
    expect(readRecordsByKeysMock).not.toHaveBeenCalled();
    // Without a cache there is no entity list to link a temporary record into.
    expect(
      optimisticData.applyEntityPropertyOptionDeltas.properties
    ).toMatchObject([{ id: 'assignment-1', propertyDefinitionId: 'tag-def' }]);
    expect(options.updates).toEqual([]);
  });

  it('resolves a queued commit with the requested selection', async () => {
    optimisticMutationDispositionOfMock.mockReturnValue({
      kind: 'queued',
      transactionId: 'txn-1',
    });

    await expect(
      updateGraphqlEntityPropertyOptions({
        entityType: 'DOCUMENT',
        entityId: 'doc-1',
        properties: [
          {
            property: tagProperty,
            currentOptionIds: [],
            nextOptionIds: ['spotlight'],
          },
        ],
      })
    ).resolves.toEqual([
      { propertyDefinitionId: 'tag-def', optionIds: ['spotlight'] },
    ]);
  });

  it('throws a permanent failure so the caller can surface it', async () => {
    const error = new Error('forbidden');
    optimisticMutationDispositionOfMock.mockReturnValue({
      kind: 'permanently-failed',
      error,
    });

    await expect(
      updateGraphqlEntityPropertyOptions({
        entityType: 'DOCUMENT',
        entityId: 'doc-1',
        properties: [
          {
            property: tagProperty,
            currentOptionIds: [],
            nextOptionIds: ['spotlight'],
          },
        ],
      })
    ).rejects.toThrow('forbidden');
  });

  it('reconciles from the server when a concurrent edit merged in', async () => {
    optimisticMutationDispositionOfMock.mockReturnValue(
      committedWith(['spotlight', 'roadmap'])
    );

    await expect(
      updateGraphqlEntityPropertyOptions({
        entityType: 'DOCUMENT',
        entityId: 'doc-1',
        properties: [
          {
            property: tagProperty,
            currentOptionIds: [],
            nextOptionIds: ['spotlight'],
          },
        ],
      })
    ).resolves.toEqual([
      { propertyDefinitionId: 'tag-def', optionIds: ['spotlight', 'roadmap'] },
    ]);
  });
});
