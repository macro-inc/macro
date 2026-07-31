import type { Property, PropertyDefinitionDomain } from '@property/types';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { type Accessor, createSignal, type JSX, type Setter } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, onEnd, pipe } from 'wonka';

const useFeatureFlagMock = vi.hoisted(() => vi.fn());
const setEntityPropertyMock = vi.hoisted(() => vi.fn());
const buildEntityPropertiesInputMock = vi.hoisted(() => vi.fn());
const mapGraphqlEntityPropertiesMock = vi.hoisted(() => vi.fn());
const fetchGraphqlEntityPropertiesMock = vi.hoisted(() => vi.fn());
const graphqlQueryMock = vi.hoisted(() => vi.fn());
const getRestEntityPropertiesMock = vi.hoisted(() => vi.fn());
const deleteEntityPropertyMock = vi.hoisted(() => vi.fn());
const addEntityPropertyOptionMock = vi.hoisted(() => vi.fn());
const bulkUpdateEntityPropertyOptionsMock = vi.hoisted(() => vi.fn());
const isInstantiatedPropertyMock = vi.hoisted(() => vi.fn());
const buildOptimisticSetEntityPropertyMock = vi.hoisted(() => vi.fn());
const entityPropertyFromApiMock = vi.hoisted(() => vi.fn());
const soupPropertyToPropertyMock = vi.hoisted(() => vi.fn());
const rollbackMock = vi.hoisted(() => vi.fn());
const optimisticUpdateSoupEntityMock = vi.hoisted(() => vi.fn());
const invalidateSoupEntityMock = vi.hoisted(() => vi.fn());
const graphqlSoupEnabledMock = vi.hoisted(() => vi.fn(() => true));
const toastFailureMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());
const settlementCallbacks = vi.hoisted(
  () =>
    new Set<
      (settlement: {
        transactionId: string;
        status: 'committed' | 'permanently-failed';
        error?: string;
      }) => void
    >()
);

vi.mock('@app/lib/analytics', () => ({
  analytics: { track: trackMock },
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: toastFailureMock },
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_SOUP: graphqlSoupEnabledMock,
  ENABLE_GRAPHQL_SOUP_FLAG: 'enable-graphql-soup',
  ENABLE_GRAPHQL_SOUP_OVERRIDE: undefined,
}));

vi.mock('@entity/extractors-property/property-helpers', () => ({
  soupPropertyToProperty: soupPropertyToPropertyMock,
}));

vi.mock('@property/api/converters', () => ({
  entityPropertyFromApi: entityPropertyFromApiMock,
  propertyValueToApi: vi.fn(() => ({ type: 'string', value: 'doing' })),
}));

vi.mock('@property/utils', () => ({
  isInstantiatedProperty: isInstantiatedPropertyMock,
}));

vi.mock('../../service-clients/service-properties/client', () => ({
  propertiesServiceClient: {
    getEntityProperties: getRestEntityPropertiesMock,
    deleteEntityProperty: deleteEntityPropertyMock,
    addEntityPropertyOption: addEntityPropertyOptionMock,
    bulkUpdateEntityPropertyOptions: bulkUpdateEntityPropertyOptionsMock,
  },
}));

vi.mock('./graphql/entity-properties', () => ({
  buildEntityPropertiesInput: buildEntityPropertiesInputMock,
  mapGraphqlEntityProperties: mapGraphqlEntityPropertiesMock,
  fetchGraphqlEntityProperties: fetchGraphqlEntityPropertiesMock,
}));

vi.mock('../../service-clients/service-storage/graphql-properties', () => ({
  setEntityProperty: setEntityPropertyMock,
}));

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('../../service-clients/service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(() => ({ executeQuery: graphqlQueryMock })),
  getGraphqlCacheHost: vi.fn(() => ({
    onMutationSettled: (
      callback: (settlement: {
        transactionId: string;
        status: 'committed' | 'permanently-failed';
        error?: string;
      }) => void
    ) => {
      settlementCallbacks.add(callback);
      return () => settlementCallbacks.delete(callback);
    },
  })),
}));

vi.mock('../soup/cache', () => ({
  getSoupEntityById: vi.fn(() => ({
    tag: 'document',
    data: {
      id: 'task-1',
      properties: [
        {
          id: 'assignment-1',
          definition: { id: 'status-def' },
          value: { type: 'String', value: 'todo' },
        },
      ],
    },
    frecency_score: 0,
  })),
  invalidateSoupEntity: invalidateSoupEntityMock,
  optimisticUpdateSoupEntity: optimisticUpdateSoupEntityMock.mockImplementation(
    () => ({ rollback: rollbackMock })
  ),
}));

vi.mock('../soup/grouped/graphql-optimistic', () => ({
  buildOptimisticGroupedPropertyUpdates: vi.fn(async () => undefined),
  groupedPropertyKeys: vi.fn(() => []),
}));

vi.mock('./graphql-optimistic', () => ({
  buildOptimisticSetEntityProperty: buildOptimisticSetEntityPropertyMock,
}));

import {
  useAddEntityPropertyMutation,
  useAddEntityPropertyOptionMutation,
  useBulkSaveEntityPropertiesMutation,
  useBulkUpdateEntityPropertyOptionsMutation,
  useDeleteEntityPropertyMutation,
  useEntityPropertiesQuery,
} from './entity';

let testQueryClient: QueryClient;
let mutation: ReturnType<typeof useBulkSaveEntityPropertiesMutation>;
let addMutation: ReturnType<typeof useAddEntityPropertyMutation>;
let deleteMutation: ReturnType<typeof useDeleteEntityPropertyMutation>;
let addOptionMutation: ReturnType<typeof useAddEntityPropertyOptionMutation>;
let bulkOptionsMutation: ReturnType<
  typeof useBulkUpdateEntityPropertyOptionsMutation
>;
let entityQuery: ReturnType<typeof useEntityPropertiesQuery>;
let dispose: (() => void) | undefined;
let setGraphqlFlagEnabled: Setter<boolean>;
let graphqlExecutions: Array<{
  variables: unknown;
  context: unknown;
  next: (result: unknown) => void;
  ended: boolean;
}>;

const property = {
  propertyId: 'assignment-1',
  propertyDefinitionId: 'status-def',
  displayName: 'Status',
  valueType: 'STRING',
  isMultiSelect: false,
  isSystemProperty: true,
} as unknown as Property;

const propertyDefinition = {
  id: 'new-definition',
  displayName: 'New property',
  valueType: 'STRING',
  isMultiSelect: false,
  isSystem: false,
} as unknown as PropertyDefinitionDomain;

const variables = {
  properties: [
    {
      entityId: 'task-1',
      entityType: 'TASK' as const,
      property,
      apiValues: { valueType: 'STRING' as const, value: 'doing' },
    },
  ],
};

function renderWithQueryClient(factory: () => void): void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    container
  );
}

function renderMutation(): void {
  renderWithQueryClient(() => {
    mutation = useBulkSaveEntityPropertiesMutation();
    addMutation = useAddEntityPropertyMutation();
    deleteMutation = useDeleteEntityPropertyMutation();
    addOptionMutation = useAddEntityPropertyOptionMutation();
    bulkOptionsMutation = useBulkUpdateEntityPropertyOptionsMutation('task-1');
  });
}

function renderEntityQuery(
  includeMetadata: boolean,
  entityType: 'DOCUMENT' | 'USER' | Accessor<'DOCUMENT' | 'USER'> = 'DOCUMENT',
  entityId: string | Accessor<string> = 'document-1'
): void {
  const type = typeof entityType === 'function' ? entityType : () => entityType;
  const id = typeof entityId === 'function' ? entityId : () => entityId;
  renderWithQueryClient(() => {
    entityQuery = useEntityPropertiesQuery(type, id, includeMetadata);
  });
}

describe('useEntityPropertiesQuery transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphqlSoupEnabledMock.mockReturnValue(true);
    const [graphqlFlagEnabled, setEnabled] = createSignal(true);
    setGraphqlFlagEnabled = setEnabled;
    useFeatureFlagMock.mockReturnValue(() => ({
      enabled: graphqlFlagEnabled(),
      payload: undefined,
    }));
    graphqlExecutions = [];
    graphqlQueryMock.mockImplementation(
      (request: { variables: unknown }, context: unknown) => {
        const subject = makeSubject<unknown>();
        const execution = {
          variables: request.variables,
          context,
          next: subject.next,
          ended: false,
        };
        graphqlExecutions.push(execution);
        return pipe(
          subject.source,
          onEnd(() => {
            execution.ended = true;
          })
        );
      }
    );
    buildEntityPropertiesInputMock.mockImplementation(
      (entityType: string, entityId: string) =>
        entityType === 'USER' ? undefined : { entityType, entityId }
    );
    mapGraphqlEntityPropertiesMock.mockImplementation(
      (
        data:
          | {
              user?: {
                soup?: { items?: Array<{ id: string; properties: unknown[] }> };
              };
            }
          | undefined,
        entityId: string
      ) => {
        if (!data) return undefined;
        return (
          data.user?.soup?.items?.find((item) => item.id === entityId)
            ?.properties ?? []
        );
      }
    );
    soupPropertyToPropertyMock.mockImplementation(
      (soupProperty: { mapped: Property }) => soupProperty.mapped
    );
    fetchGraphqlEntityPropertiesMock.mockResolvedValue(undefined);
    testQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
  });

  it('keeps a live GraphQL subscription for cache-pushed results', async () => {
    const nextProperty = { ...property, displayName: 'Next status' };
    renderEntityQuery(false);

    expect(entityQuery.isLoading).toBe(true);
    expect(graphqlExecutions).toHaveLength(1);
    expect(graphqlExecutions[0]).toMatchObject({
      variables: {
        input: { entityType: 'DOCUMENT', entityId: 'document-1' },
      },
      context: { requestPolicy: 'cache-and-network' },
    });
    expect(getRestEntityPropertiesMock).not.toHaveBeenCalled();

    graphqlExecutions[0]?.next({
      data: {
        user: {
          soup: {
            items: [{ id: 'document-1', properties: [{ mapped: property }] }],
          },
        },
      },
      stale: true,
    });
    await vi.waitFor(() => expect(entityQuery.data).toEqual([property]));
    expect(entityQuery.isFetching).toBe(true);

    graphqlExecutions[0]?.next({
      data: {
        user: {
          soup: {
            items: [
              { id: 'document-1', properties: [{ mapped: nextProperty }] },
            ],
          },
        },
      },
      stale: false,
    });
    await vi.waitFor(() => expect(entityQuery.data).toEqual([nextProperty]));
    expect(entityQuery.isFetching).toBe(false);
    expect(graphqlExecutions).toHaveLength(1);
  });

  it('reactively switches transports in both directions', async () => {
    getRestEntityPropertiesMock.mockResolvedValue(ok({ properties: [] }));
    renderEntityQuery(false);
    expect(graphqlExecutions).toHaveLength(1);
    expect(useFeatureFlagMock).toHaveBeenCalledWith('enable-graphql-soup', {
      enabledOverride: undefined,
    });

    setGraphqlFlagEnabled(false);
    await vi.waitFor(() => expect(graphqlExecutions[0]?.ended).toBe(true));
    await vi.waitFor(() =>
      expect(getRestEntityPropertiesMock).toHaveBeenCalled()
    );

    setGraphqlFlagEnabled(true);
    await vi.waitFor(() => expect(graphqlExecutions).toHaveLength(2));
    expect(graphqlExecutions[1]?.ended).toBe(false);
  });

  it('clears the prior entity and resubscribes when the id changes', async () => {
    const [entityId, setEntityId] = createSignal('document-1');
    renderEntityQuery(false, 'DOCUMENT', entityId);
    graphqlExecutions[0]?.next({
      data: {
        user: {
          soup: {
            items: [{ id: 'document-1', properties: [{ mapped: property }] }],
          },
        },
      },
    });
    await vi.waitFor(() => expect(entityQuery.data).toEqual([property]));

    setEntityId('document-2');

    expect(entityQuery.data).toBeUndefined();
    expect(entityQuery.isLoading).toBe(true);
    expect(graphqlExecutions).toHaveLength(2);
    expect(graphqlExecutions[1]?.variables).toEqual({
      input: { entityType: 'DOCUMENT', entityId: 'document-2' },
    });
  });

  it('pauses both transports and makes refetch a no-op for an empty id', async () => {
    renderEntityQuery(false, 'DOCUMENT', '');

    expect(entityQuery.data).toBeUndefined();
    expect(entityQuery.isLoading).toBe(false);
    await expect(entityQuery.refetch()).resolves.toBeUndefined();
    expect(graphqlExecutions).toHaveLength(0);
    expect(fetchGraphqlEntityPropertiesMock).not.toHaveBeenCalled();
    expect(getRestEntityPropertiesMock).not.toHaveBeenCalled();
  });

  it('surfaces GraphQL errors and leaves the adapter out of loading', async () => {
    renderEntityQuery(false);
    const error = new Error('query failed');

    graphqlExecutions[0]?.next({ error });

    await vi.waitFor(() => expect(entityQuery.error).toBe(error));
    expect(entityQuery.data).toBeUndefined();
    expect(entityQuery.isLoading).toBe(false);
    expect(entityQuery.isFetching).toBe(false);
  });

  it('re-fetches the live operation from the network', async () => {
    renderEntityQuery(false);

    await entityQuery.refetch();

    expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledWith(
      'DOCUMENT',
      'document-1'
    );
  });

  it('keeps metadata requests on REST', async () => {
    const apiProperty = { property: { id: 'assignment-1' } };
    getRestEntityPropertiesMock.mockResolvedValue(
      ok({ properties: [apiProperty] })
    );
    entityPropertyFromApiMock.mockReturnValue(property);

    renderEntityQuery(true);

    await vi.waitFor(() => expect(entityQuery.data).toEqual([property]));
    expect(graphqlExecutions).toHaveLength(0);
    expect(getRestEntityPropertiesMock).toHaveBeenCalledWith({
      entity_type: 'DOCUMENT',
      entity_id: 'document-1',
      query: { include_metadata: true },
    });
  });

  it('uses REST when the GraphQL feature is disabled', async () => {
    setGraphqlFlagEnabled(false);
    getRestEntityPropertiesMock.mockResolvedValue(ok({ properties: [] }));

    renderEntityQuery(false);

    await vi.waitFor(() => expect(entityQuery.data).toEqual([]));
    expect(graphqlExecutions).toHaveLength(0);
    expect(getRestEntityPropertiesMock).toHaveBeenCalledWith({
      entity_type: 'DOCUMENT',
      entity_id: 'document-1',
      query: { include_metadata: true },
    });
  });

  it('falls back to REST for USER properties, which Soup cannot query', async () => {
    getRestEntityPropertiesMock.mockResolvedValue(ok({ properties: [] }));

    renderEntityQuery(false, 'USER', 'user-1');

    await vi.waitFor(() => expect(entityQuery.data).toEqual([]));
    expect(graphqlExecutions).toHaveLength(0);
    expect(getRestEntityPropertiesMock).toHaveBeenCalledWith({
      entity_type: 'USER',
      entity_id: 'user-1',
      query: { include_metadata: true },
    });
  });
});

describe('useBulkSaveEntityPropertiesMutation dispositions', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    vi.clearAllMocks();
    optimisticUpdateSoupEntityMock.mockReturnValue({ rollback: rollbackMock });
    isInstantiatedPropertyMock.mockReturnValue(true);
    buildOptimisticSetEntityPropertyMock.mockReturnValue({
      id: 'assignment-1',
    });
    graphqlSoupEnabledMock.mockReturnValue(true);
    fetchGraphqlEntityPropertiesMock.mockResolvedValue(undefined);
    deleteEntityPropertyMock.mockResolvedValue(ok(undefined));
    addEntityPropertyOptionMock.mockResolvedValue(ok(undefined));
    bulkUpdateEntityPropertyOptionsMock.mockResolvedValue(
      ok({ properties: [{ property_id: 'status-def', option_ids: ['doing'] }] })
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    settlementCallbacks.clear();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.spyOn(testQueryClient, 'invalidateQueries');
    renderMutation();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    dispose?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('submits GraphQL optimism while offline for the durable cache queue', async () => {
    onlineManager.setOnline(false);
    setEntityPropertyMock.mockResolvedValue({
      kind: 'queued',
      transactionId: 'txn-offline',
    });

    await expect(mutation.mutateAsync(variables)).resolves.toBeUndefined();

    expect(setEntityPropertyMock).toHaveBeenCalledOnce();
    expect(setEntityPropertyMock).toHaveBeenCalledWith(
      expect.objectContaining({ optimisticProperty: { id: 'assignment-1' } })
    );

    for (const callback of settlementCallbacks) {
      callback({ transactionId: 'txn-offline', status: 'committed' });
    }
  });

  it('mirrors queued GraphQL optimism and defers reconciliation', async () => {
    setEntityPropertyMock
      .mockResolvedValueOnce({ kind: 'queued', transactionId: 'txn-1' })
      .mockResolvedValueOnce({ kind: 'queued', transactionId: 'txn-2' });

    await expect(mutation.mutateAsync(variables)).resolves.toBeUndefined();
    await expect(mutation.mutateAsync(variables)).resolves.toBeUndefined();

    expect(optimisticUpdateSoupEntityMock).toHaveBeenCalledTimes(2);
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).not.toHaveBeenCalled();
    expect(testQueryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(toastFailureMock).not.toHaveBeenCalled();
    expect(setEntityPropertyMock).toHaveBeenCalledWith(
      expect.objectContaining({ optimisticProperty: { id: 'assignment-1' } })
    );

    for (const callback of settlementCallbacks) {
      callback({ transactionId: 'txn-1', status: 'committed' });
    }
    expect(invalidateSoupEntityMock).not.toHaveBeenCalled();

    for (const callback of settlementCallbacks) {
      callback({ transactionId: 'txn-2', status: 'committed' });
    }
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
  });

  it('registers each queued write before awaiting the next save', async () => {
    let resolveSecond!: (disposition: {
      kind: 'queued';
      transactionId: string;
    }) => void;
    setEntityPropertyMock
      .mockResolvedValueOnce({ kind: 'queued', transactionId: 'txn-race-1' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          })
      );

    const pending = mutation.mutateAsync({
      properties: [variables.properties[0]!, variables.properties[0]!],
    });
    await vi.waitFor(() =>
      expect(setEntityPropertyMock).toHaveBeenCalledTimes(2)
    );

    for (const callback of settlementCallbacks) {
      callback({ transactionId: 'txn-race-1', status: 'committed' });
    }
    expect(invalidateSoupEntityMock).not.toHaveBeenCalled();

    resolveSecond({ kind: 'queued', transactionId: 'txn-race-2' });
    await pending;
    expect(invalidateSoupEntityMock).not.toHaveBeenCalled();

    for (const callback of settlementCallbacks) {
      callback({ transactionId: 'txn-race-2', status: 'committed' });
    }
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
  });

  it('invalidates a queued write that later fails', async () => {
    setEntityPropertyMock.mockResolvedValue({
      kind: 'queued',
      transactionId: 'txn-failed',
    });
    await mutation.mutateAsync(variables);

    for (const callback of settlementCallbacks) {
      callback({
        transactionId: 'txn-failed',
        status: 'permanently-failed',
        error: 'invalid property',
      });
    }

    expect(optimisticUpdateSoupEntityMock).toHaveBeenCalledOnce();
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledWith(
      'TASK',
      'task-1'
    );
    expect(toastFailureMock).toHaveBeenCalledWith('Failed to save properties');
  });

  it('invalidates queued read projections after commit', async () => {
    setEntityPropertyMock.mockResolvedValue({
      kind: 'queued',
      transactionId: 'txn-committed',
    });
    await mutation.mutateAsync(variables);

    for (const callback of settlementCallbacks) {
      callback({
        transactionId: 'txn-committed',
        status: 'committed',
      });
    }

    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledWith(
      'TASK',
      'task-1'
    );
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('invalidates GraphQL permanent failures without snapshot rollback', async () => {
    setEntityPropertyMock.mockResolvedValue({
      kind: 'permanently-failed',
      error: new Error('invalid property'),
    });

    await expect(mutation.mutateAsync(variables)).rejects.toThrow(
      'One or more properties permanently failed to save'
    );

    expect(optimisticUpdateSoupEntityMock).toHaveBeenCalledOnce();
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).toHaveBeenCalledOnce();
  });

  it('invalidates the TanStack projection after an immediate GraphQL commit', async () => {
    setEntityPropertyMock.mockResolvedValue({ kind: 'committed' });

    await mutation.mutateAsync(variables);

    expect(optimisticUpdateSoupEntityMock).toHaveBeenCalledOnce();
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(fetchGraphqlEntityPropertiesMock).not.toHaveBeenCalled();
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it.each([
    ['new assignment first', [propertyDefinition, property]],
    ['new assignment last', [property, propertyDefinition]],
  ] as const)(
    'refetches an immediate edge when the %s',
    async (_label, properties) => {
      isInstantiatedPropertyMock.mockImplementation(
        (value) => value === property
      );
      buildOptimisticSetEntityPropertyMock.mockImplementation((value) =>
        value === property ? { id: 'assignment-1' } : undefined
      );
      setEntityPropertyMock.mockResolvedValue({ kind: 'committed' });

      await mutation.mutateAsync({
        properties: properties.map((item) => ({
          entityId: 'task-1',
          entityType: 'TASK' as const,
          property: item,
          apiValues: { valueType: 'STRING' as const, value: 'doing' },
        })),
      });

      await vi.waitFor(() =>
        expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledOnce()
      );
    }
  );

  it('refetches immediate and queued commits independently', async () => {
    isInstantiatedPropertyMock.mockImplementation(
      (value) => value === property
    );
    buildOptimisticSetEntityPropertyMock.mockImplementation((value) =>
      value === property ? { id: 'assignment-1' } : undefined
    );
    setEntityPropertyMock
      .mockResolvedValueOnce({ kind: 'queued', transactionId: 'txn-mixed' })
      .mockResolvedValueOnce({ kind: 'committed' });

    await mutation.mutateAsync({
      properties: [
        variables.properties[0]!,
        {
          entityId: 'task-1',
          entityType: 'TASK',
          property: propertyDefinition,
          apiValues: { valueType: 'STRING', value: 'doing' },
        },
      ],
    });
    expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledOnce();

    for (const callback of settlementCallbacks) {
      callback({ transactionId: 'txn-mixed', status: 'committed' });
    }
    expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes both read owners for a new GraphQL attachment', async () => {
    setEntityPropertyMock.mockResolvedValue({ kind: 'committed' });

    await addMutation.mutateAsync({
      entityId: 'task-1',
      entityType: 'TASK',
      propertyDefinitionId: 'status-def',
    });

    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledWith(
      'TASK',
      'task-1'
    );
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('refreshes GraphQL after REST-backed delete and option writes', async () => {
    await deleteMutation.mutateAsync({
      entityPropertyId: 'assignment-1',
      entityType: 'TASK',
      entityId: 'task-1',
    });
    await addOptionMutation.mutateAsync({
      entityId: 'task-1',
      entityType: 'TASK',
      property,
      optionId: 'doing',
      optimisticOptionIds: ['doing'],
    });

    expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledTimes(2);
    expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledWith(
      'TASK',
      'task-1'
    );
    expect(testQueryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('does not turn a failed post-write refresh into an attachment failure', async () => {
    const refreshError = new Error('refresh failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setEntityPropertyMock.mockResolvedValue({ kind: 'committed' });
    fetchGraphqlEntityPropertiesMock.mockRejectedValue(refreshError);

    await expect(
      addMutation.mutateAsync({
        entityId: 'task-1',
        entityType: 'TASK',
        propertyDefinitionId: 'status-def',
      })
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      'Failed to refresh GraphQL entity properties',
      refreshError
    );
  });

  it('does not refetch GraphQL after a failed attachment write', async () => {
    setEntityPropertyMock.mockResolvedValue({
      kind: 'permanently-failed',
      error: new Error('add failed'),
    });

    await expect(
      addMutation.mutateAsync({
        entityId: 'task-1',
        entityType: 'TASK',
        propertyDefinitionId: 'status-def',
      })
    ).rejects.toThrow('add failed');

    expect(fetchGraphqlEntityPropertiesMock).not.toHaveBeenCalled();
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('does not refetch GraphQL after failed REST-backed writes', async () => {
    deleteEntityPropertyMock.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'delete failed' }])
    );
    await expect(
      deleteMutation.mutateAsync({
        entityPropertyId: 'assignment-1',
        entityType: 'TASK',
        entityId: 'task-1',
      })
    ).rejects.toThrow('delete failed');

    addEntityPropertyOptionMock.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'option failed' }])
    );
    await expect(
      addOptionMutation.mutateAsync({
        entityId: 'task-1',
        entityType: 'TASK',
        property,
        optionId: 'doing',
        optimisticOptionIds: ['doing'],
      })
    ).rejects.toThrow('option failed');

    bulkUpdateEntityPropertyOptionsMock.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'bulk failed' }])
    );
    await expect(
      bulkOptionsMutation.mutateAsync({
        entityId: 'task-1',
        entityType: 'TASK',
        properties: [
          {
            property,
            currentOptionIds: [],
            nextOptionIds: ['doing'],
          },
        ],
      })
    ).rejects.toThrow('bulk failed');

    expect(fetchGraphqlEntityPropertiesMock).not.toHaveBeenCalled();
    expect(testQueryClient.invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it('keeps bulk option updates pending until both reads reconcile', async () => {
    let finishRefresh!: () => void;
    fetchGraphqlEntityPropertiesMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      })
    );

    const pending = bulkOptionsMutation.mutateAsync({
      entityId: 'task-1',
      entityType: 'TASK',
      properties: [
        {
          property,
          currentOptionIds: [],
          nextOptionIds: ['doing'],
        },
      ],
    });
    await vi.waitFor(() =>
      expect(fetchGraphqlEntityPropertiesMock).toHaveBeenCalledOnce()
    );
    expect(bulkOptionsMutation.isPending).toBe(true);

    finishRefresh();
    await pending;
    expect(bulkOptionsMutation.isPending).toBe(false);
  });

  it('keeps the existing TanStack lifecycle when GraphQL Soup is disabled', async () => {
    graphqlSoupEnabledMock.mockReturnValue(false);
    setEntityPropertyMock.mockResolvedValue({
      kind: 'permanently-failed',
      error: new Error('invalid property'),
    });

    await expect(mutation.mutateAsync(variables)).rejects.toThrow(
      'One or more properties permanently failed to save'
    );

    expect(optimisticUpdateSoupEntityMock).toHaveBeenCalledOnce();
    expect(rollbackMock).toHaveBeenCalledOnce();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).toHaveBeenCalledOnce();
  });
});
