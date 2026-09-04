import type { Property, PropertyDefinitionDomain } from '@property/types';
import { validate as validateUuid } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeOptimisticMutationMock = vi.hoisted(() => vi.fn());
const optimisticMutationDispositionOfMock = vi.hoisted(() => vi.fn());
const inspectMock = vi.hoisted(() => vi.fn());
const cacheHostState = vi.hoisted(() => ({ current: {} as unknown }));

vi.mock('@graphql-cache/index', () => {
  const selection = {
    field: () => selection,
  };
  return {
    executeOptimisticMutation: executeOptimisticMutationMock,
    optimisticMutationDispositionOf: optimisticMutationDispositionOfMock,
    inspect: inspectMock,
    selectAll: () => selection,
  };
});

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
  getGraphqlCacheHost: () => cacheHostState.current,
}));

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
      updateEntityPropertyOptions: [
        {
          propertyDefinitionId: 'tag-def',
          value: {
            __typename: 'GraphqlSelectOptionPropertyValue',
            optionIds,
          },
        },
      ],
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
    expect(optimisticData.updateEntityPropertyOptions).toMatchObject([
      {
        id: 'assignment-1',
        propertyDefinitionId: 'tag-def',
        value: {
          __typename: 'GraphqlSelectOptionPropertyValue',
          optionIds: ['spotlight'],
        },
      },
    ]);
    // The record already exists, so the entity's property link list is intact.
    expect(options.revalidations).toEqual([]);
    expect(validateUuid(options.uuid)).toBe(true);
    expect(inspectMock).not.toHaveBeenCalled();
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

  it('revalidates only the cached queries holding the entity when it has no record for the definition', async () => {
    inspectMock
      .mockResolvedValueOnce([
        {
          variables: { input: 'soup-with' },
          value: { items: [{ id: 'doc-1' }] },
        },
        {
          variables: { input: 'soup-without' },
          value: { items: [{ id: 'other' }] },
        },
        { variables: { input: 'soup-unreadable' }, value: undefined },
      ])
      .mockResolvedValueOnce([
        {
          variables: { input: 'grouped-with' },
          value: { bins: [{ items: [{ id: 'doc-1' }] }] },
        },
        {
          variables: { input: 'grouped-without' },
          value: { bins: [{ items: [] }] },
        },
      ]);

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
    // No assignment id exists yet, so nothing can be patched before the commit.
    expect(optimisticData.updateEntityPropertyOptions).toEqual([]);
    expect(
      options.revalidations.map(
        (revalidation: { variables: { input: string } }) =>
          revalidation.variables.input
      )
    ).toEqual(['soup-with', 'grouped-with']);
  });

  it('skips revalidation discovery when the normalized cache is unavailable', async () => {
    cacheHostState.current = undefined;

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

    expect(inspectMock).not.toHaveBeenCalled();
    expect(optimisticArgs().options.revalidations).toEqual([]);
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
