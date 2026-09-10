import type { Property } from '@property/types';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import { err, ok } from 'neverthrow';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  type Setter,
} from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, onEnd, pipe } from 'wonka';
import { EntityPropertiesDocument } from '../../service-clients/service-storage/graphql/generated/graphql';
import { createUrqlQuery } from '../../urql-solid';

const useFeatureFlagMock = vi.hoisted(() => vi.fn());
const graphqlEntityPropertyMutationMock = vi.hoisted(() => vi.fn());
const createGraphqlAddEntityPropertyMutationMock = vi.hoisted(() => vi.fn());
const createGraphqlBulkSaveEntityPropertiesMutationMock = vi.hoisted(() =>
  vi.fn()
);
const buildEntityPropertiesInputMock = vi.hoisted(() => vi.fn());
const mapGraphqlEntityPropertiesMock = vi.hoisted(() => vi.fn());
const createGraphqlEntityPropertiesQueryMock = vi.hoisted(() => vi.fn());
const graphqlQueryMock = vi.hoisted(() => vi.fn());
const getRestEntityPropertiesMock = vi.hoisted(() => vi.fn());
const deleteEntityPropertyMock = vi.hoisted(() => vi.fn());
const addEntityPropertyOptionMock = vi.hoisted(() => vi.fn());
const bulkUpdateEntityPropertyOptionsMock = vi.hoisted(() => vi.fn());
const updateGraphqlEntityPropertyOptionsMock = vi.hoisted(() => vi.fn());
const setRestEntityPropertyMock = vi.hoisted(() => vi.fn());
const isInstantiatedPropertyMock = vi.hoisted(() => vi.fn());
const entityPropertyFromApiMock = vi.hoisted(() => vi.fn());
const soupPropertyToPropertyMock = vi.hoisted(() => vi.fn());
const rollbackMock = vi.hoisted(() => vi.fn());
const optimisticUpdateSoupEntityMock = vi.hoisted(() => vi.fn());
const invalidateSoupEntityMock = vi.hoisted(() => vi.fn());
const graphqlSoupEnabledMock = vi.hoisted(() => vi.fn(() => true));
const toastFailureMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());

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
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: graphqlSoupEnabledMock,
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
    setEntityProperty: setRestEntityPropertyMock,
    deleteEntityProperty: deleteEntityPropertyMock,
    addEntityPropertyOption: addEntityPropertyOptionMock,
    bulkUpdateEntityPropertyOptions: bulkUpdateEntityPropertyOptionsMock,
  },
}));

vi.mock('./graphql/entity', () => ({
  createGraphqlEntityPropertiesQuery: createGraphqlEntityPropertiesQueryMock,
  createGraphqlAddEntityPropertyMutation:
    createGraphqlAddEntityPropertyMutationMock,
  createGraphqlBulkSaveEntityPropertiesMutation:
    createGraphqlBulkSaveEntityPropertiesMutationMock,
}));

vi.mock('./graphql/entity-options', () => ({
  updateGraphqlEntityPropertyOptions: updateGraphqlEntityPropertyOptionsMock,
}));

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
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
    createGraphqlEntityPropertiesQueryMock.mockImplementation(
      (options: {
        entityType: Accessor<string>;
        entityId: Accessor<string>;
        enabled: Accessor<boolean>;
      }) => {
        const input = createMemo(() => {
          const entityId = options.entityId();
          if (!options.enabled() || entityId.length === 0) return undefined;
          return buildEntityPropertiesInputMock(options.entityType(), entityId);
        });
        const result = createUrqlQuery(() => {
          const currentInput = input();
          const entityId = options.entityId();
          return {
            query: EntityPropertiesDocument,
            client: {
              executeQuery: graphqlQueryMock,
            } as unknown as Client,
            variables: { input: currentInput! },
            enabled: currentInput !== undefined,
            requestPolicy: 'cache-and-network' as const,
            keepPreviousData: false,
            select: (data: unknown) =>
              (
                (mapGraphqlEntityPropertiesMock(data, entityId) ??
                  []) as Array<{
                  mapped: Property;
                }>
              ).flatMap((property) => {
                const mapped = soupPropertyToPropertyMock(property) as Property;
                return mapped.isMetadata === true ? [] : [mapped];
              }),
          };
        });
        return {
          result,
          isEnabled: () => input() !== undefined,
          refetch: () => result.refetch({ requestPolicy: 'network-only' }),
        };
      }
    );
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
    expect(useFeatureFlagMock).toHaveBeenCalledWith({
      key: 'enable-graphql-soup',
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

    const refetch = entityQuery.refetch();
    await vi.waitFor(() => expect(graphqlExecutions).toHaveLength(2));
    expect(graphqlExecutions[1]?.context).toMatchObject({
      requestPolicy: 'network-only',
    });
    graphqlExecutions[1]?.next({ data: { user: { soup: { items: [] } } } });
    await refetch;
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
    graphqlEntityPropertyMutationMock.mockResolvedValue({ kind: 'committed' });
    createGraphqlAddEntityPropertyMutationMock.mockImplementation(
      (options: {
        onMutate?: (input: {
          entityId: string;
          entityType: string;
          propertyDefinitionId: string;
        }) => unknown;
        onSuccess?: (input: unknown, context: unknown) => unknown;
        onError?: (error: Error, input: unknown, context: unknown) => unknown;
        onSettled?: (
          error: Error | null,
          input: unknown,
          context: unknown
        ) => unknown;
      }) => {
        let isPending = false;
        let error: Error | null = null;
        const mutateAsync = async (input: {
          entityId: string;
          entityType: string;
          propertyDefinitionId: string;
        }) => {
          isPending = true;
          const context = await options.onMutate?.(input);
          let settledError: Error | null = null;
          try {
            const disposition = await graphqlEntityPropertyMutationMock({
              kind: 'add',
              ...input,
            });
            if (disposition.kind === 'permanently-failed') {
              throw disposition.error;
            }
            await options.onSuccess?.(input, context);
            return { error: null };
          } catch (cause) {
            settledError =
              cause instanceof Error ? cause : new Error(String(cause));
            error = settledError;
            await options.onError?.(settledError, input, context);
            throw settledError;
          } finally {
            await options.onSettled?.(settledError, input, context);
            isPending = false;
          }
        };
        return {
          get isPending() {
            return isPending;
          },
          get error() {
            return error;
          },
          mutate: (input: {
            entityId: string;
            entityType: string;
            propertyDefinitionId: string;
          }) => {
            void mutateAsync(input).catch(() => undefined);
          },
          mutateAsync,
        };
      }
    );
    createGraphqlBulkSaveEntityPropertiesMutationMock.mockImplementation(
      (options: {
        onMutate?: (input: typeof variables) => unknown;
        onCommitted?: (
          item: (typeof variables)['properties'][number],
          disposition: { kind: 'committed' }
        ) => unknown;
        onSuccess?: (input: typeof variables, context: unknown) => unknown;
        onError?: (
          error: Error,
          input: typeof variables,
          context: unknown
        ) => unknown;
        onSettled?: (
          error: Error | null,
          input: typeof variables,
          context: unknown
        ) => unknown;
      }) => {
        let isPending = false;
        let error: Error | null = null;
        const mutateAsync = async (input: typeof variables) => {
          isPending = true;
          const context = await options.onMutate?.(input);
          let settledError: Error | null = null;
          try {
            for (const item of input.properties) {
              const disposition = await graphqlEntityPropertyMutationMock({
                kind: 'save',
                ...item,
              });
              if (disposition.kind === 'committed') {
                await options.onCommitted?.(item, disposition);
              } else if (disposition.kind === 'permanently-failed') {
                throw disposition.error;
              }
            }
            await options.onSuccess?.(input, context);
            return { error: null };
          } catch (cause) {
            settledError =
              cause instanceof Error ? cause : new Error(String(cause));
            error = settledError;
            await options.onError?.(settledError, input, context);
            throw settledError;
          } finally {
            await options.onSettled?.(settledError, input, context);
            isPending = false;
          }
        };
        return {
          get isPending() {
            return isPending;
          },
          get error() {
            return error;
          },
          mutate: (input: typeof variables) => {
            void mutateAsync(input).catch(() => undefined);
          },
          mutateAsync,
        };
      }
    );
    setRestEntityPropertyMock.mockResolvedValue(ok({ success: true }));
    graphqlSoupEnabledMock.mockReturnValue(true);
    deleteEntityPropertyMock.mockResolvedValue(ok(undefined));
    addEntityPropertyOptionMock.mockResolvedValue(ok(undefined));
    bulkUpdateEntityPropertyOptionsMock.mockResolvedValue(
      ok({ properties: [{ property_id: 'status-def', option_ids: ['doing'] }] })
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    graphqlEntityPropertyMutationMock.mockResolvedValue({
      kind: 'queued',
      transactionId: 'txn-offline',
    });

    await expect(mutation.mutateAsync(variables)).resolves.toBeUndefined();

    expect(graphqlEntityPropertyMutationMock).toHaveBeenCalledOnce();
    expect(graphqlEntityPropertyMutationMock).toHaveBeenCalledWith({
      kind: 'save',
      ...variables.properties[0],
    });
    expect(optimisticUpdateSoupEntityMock).not.toHaveBeenCalled();
  });

  it('treats queued GraphQL saves as accepted submissions', async () => {
    graphqlEntityPropertyMutationMock.mockResolvedValue({
      kind: 'queued',
      transactionId: 'txn-queued',
    });

    await expect(mutation.mutateAsync(variables)).resolves.toBeUndefined();

    expect(optimisticUpdateSoupEntityMock).not.toHaveBeenCalled();
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('invalidates GraphQL permanent failures without snapshot rollback', async () => {
    graphqlEntityPropertyMutationMock.mockResolvedValue({
      kind: 'permanently-failed',
      error: new Error('invalid property'),
    });

    await expect(mutation.mutateAsync(variables)).rejects.toThrow(
      'invalid property'
    );

    expect(optimisticUpdateSoupEntityMock).not.toHaveBeenCalled();
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).toHaveBeenCalledOnce();
  });

  it('exposes transport-neutral pending state', async () => {
    let resolve!: (value: { kind: 'committed' }) => void;
    graphqlEntityPropertyMutationMock.mockImplementation(
      () =>
        new Promise((resolveMutation) => {
          resolve = resolveMutation;
        })
    );

    const pending = mutation.mutateAsync(variables);
    await vi.waitFor(() => expect(mutation.isPending).toBe(true));
    await vi.waitFor(() =>
      expect(graphqlEntityPropertyMutationMock).toHaveBeenCalledOnce()
    );

    resolve({ kind: 'committed' });
    await pending;
    expect(mutation.isPending).toBe(false);
  });

  it('invalidates the TanStack projection after an immediate GraphQL commit', async () => {
    graphqlEntityPropertyMutationMock.mockResolvedValue({ kind: 'committed' });

    await mutation.mutateAsync(variables);

    expect(optimisticUpdateSoupEntityMock).not.toHaveBeenCalled();
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('invalidates the REST projection for a new GraphQL attachment', async () => {
    graphqlEntityPropertyMutationMock.mockResolvedValue({ kind: 'committed' });

    await addMutation.mutateAsync({
      entityId: 'task-1',
      entityType: 'TASK',
      propertyDefinitionId: 'status-def',
    });

    expect(graphqlEntityPropertyMutationMock).toHaveBeenCalledWith({
      kind: 'add',
      entityId: 'task-1',
      entityType: 'TASK',
      propertyDefinitionId: 'status-def',
    });
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('invalidates REST projections after delete and option writes', async () => {
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

    expect(testQueryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('invalidates REST after a failed attachment write', async () => {
    graphqlEntityPropertyMutationMock.mockResolvedValue({
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

    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('invalidates REST after failed REST-backed writes', async () => {
    // Option selections have their own GraphQL transport, so this REST-only
    // assertion needs the flag off for the bulk-options write below.
    graphqlSoupEnabledMock.mockReturnValue(false);
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

    expect(testQueryClient.invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it('keeps the existing TanStack lifecycle when GraphQL Soup is disabled', async () => {
    graphqlSoupEnabledMock.mockReturnValue(false);
    setRestEntityPropertyMock.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'invalid property' }])
    );

    await expect(mutation.mutateAsync(variables)).rejects.toThrow(
      'One or more properties permanently failed to save'
    );

    expect(optimisticUpdateSoupEntityMock).toHaveBeenCalledOnce();
    expect(rollbackMock).toHaveBeenCalledOnce();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).toHaveBeenCalledOnce();
  });

  const optionSelection = {
    entityId: 'task-1',
    entityType: 'TASK' as const,
    properties: [
      { property, currentOptionIds: ['todo'], nextOptionIds: ['doing'] },
    ],
  };

  it('commits option selections through GraphQL when Soup is GraphQL-backed', async () => {
    updateGraphqlEntityPropertyOptionsMock.mockResolvedValue([
      { propertyDefinitionId: 'status-def', optionIds: ['doing'] },
    ]);

    await expect(
      bulkOptionsMutation.mutateAsync(optionSelection)
    ).resolves.toEqual([
      { propertyDefinitionId: 'status-def', optionIds: ['doing'] },
    ]);

    expect(updateGraphqlEntityPropertyOptionsMock).toHaveBeenCalledWith(
      optionSelection
    );
    expect(bulkUpdateEntityPropertyOptionsMock).not.toHaveBeenCalled();
  });

  it('rolls back and reports a failed GraphQL option selection', async () => {
    updateGraphqlEntityPropertyOptionsMock.mockRejectedValue(
      new Error('options failed')
    );

    await expect(
      bulkOptionsMutation.mutateAsync(optionSelection)
    ).rejects.toThrow('options failed');

    expect(bulkUpdateEntityPropertyOptionsMock).not.toHaveBeenCalled();
    expect(toastFailureMock).toHaveBeenCalledOnce();
  });

  it('keeps option selections on REST when GraphQL Soup is disabled', async () => {
    graphqlSoupEnabledMock.mockReturnValue(false);

    await expect(
      bulkOptionsMutation.mutateAsync(optionSelection)
    ).resolves.toEqual([
      { propertyDefinitionId: 'status-def', optionIds: ['doing'] },
    ]);

    expect(bulkUpdateEntityPropertyOptionsMock).toHaveBeenCalledOnce();
    expect(updateGraphqlEntityPropertyOptionsMock).not.toHaveBeenCalled();
  });
});
