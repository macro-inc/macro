import type { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';
import type { Property } from '@property/types';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { type Client, CombinedError } from '@urql/core';
import { err, ok } from 'neverthrow';
import { type Accessor, createMemo, createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
import { makeSubject, onEnd, pipe } from 'wonka';
import {
  DeleteEntityPropertyDocument,
  EntityPropertiesDocument,
} from '../../service-clients/service-storage/graphql/generated/graphql';
import { createUrqlQuery } from '../../urql-solid';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';

const graphqlEntityPropertyMutationMock = vi.hoisted(() => vi.fn());
const createGraphqlAddEntityPropertyMutationMock = vi.hoisted(() => vi.fn());
const createGraphqlBulkSaveEntityPropertiesMutationMock = vi.hoisted(() =>
  vi.fn()
);
const buildEntityPropertiesInputMock = vi.hoisted(() => vi.fn());
const openWithSplitMock = vi.hoisted(() => vi.fn());
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: openWithSplitMock }),
}));
const mapGraphqlEntityPropertiesMock = vi.hoisted(() => vi.fn());
const createGraphqlEntityPropertiesQueryMock = vi.hoisted(() => vi.fn());
const graphqlQueryMock = vi.hoisted(() => vi.fn());
const initiativePropertyQueryMock = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => ({ toPromise: async () => ({ data: {} }) }))
);
const initiativePropertyDeleteMock = vi.hoisted(() =>
  vi.fn(() => ({
    toPromise: async () => ({
      data: {
        deleteEntityProperty: {
          __typename: 'GraphqlCacheDeletion',
          graphqlTypeName: 'GraphqlProperty',
          entityId: 'assignment-1',
        },
      },
    }),
  }))
);

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlCacheHost: () => ({}),
  getGraphqlSoupClient: () => ({
    query: initiativePropertyQueryMock,
    mutation: initiativePropertyDeleteMock,
  }),
}));
const getRestEntityPropertiesMock = vi.hoisted(() => vi.fn());
const deleteEntityPropertyMock = vi.hoisted(() => vi.fn());
const updateGraphqlEntityPropertyOptionsMock = vi.hoisted(() => vi.fn());
const isInstantiatedPropertyMock = vi.hoisted(() => vi.fn());
const entityPropertyFromApiMock = vi.hoisted(() => vi.fn());
const soupPropertyToPropertyMock = vi.hoisted(() => vi.fn());
const rollbackMock = vi.hoisted(() => vi.fn());
const optimisticUpdateSoupEntityMock = vi.hoisted(() => vi.fn());
const invalidateSoupEntityMock = vi.hoisted(() => vi.fn());
const bumpSoupEntityTouchedAtMock = vi.hoisted(() => vi.fn());
const refreshPropertyQueriesMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../soup/property-queries', () => ({
  refreshPropertyQueries: refreshPropertyQueriesMock,
}));
const refreshCrmListsMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../soup/crm-association', () => ({
  refreshCrmAssociatedSoupQueries: refreshCrmListsMock,
}));
const readFirstOpenBlockerMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string | undefined> => undefined)
);
vi.mock('./graphql/task-dependencies', () => ({
  readFirstOpenBlocker: readFirstOpenBlockerMock,
}));
const toastFailureMock = vi.hoisted(() => vi.fn<typeof toast.failure>());
const trackMock = vi.hoisted(() => vi.fn());

vi.mock('@app/lib/analytics', () => ({
  analytics: { track: trackMock },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: toastFailureMock },
}));

vi.mock('@entity/extractors-property/property-helpers', () => ({
  soupPropertyToProperty: soupPropertyToPropertyMock,
}));

vi.mock('@property/api/converters', () => ({
  entityPropertyFromApi: entityPropertyFromApiMock,
}));

vi.mock('@property/utils', () => ({
  isInstantiatedProperty: isInstantiatedPropertyMock,
}));

vi.mock('../../service-clients/service-properties/client', () => ({
  propertiesServiceClient: {
    getEntityProperties: getRestEntityPropertiesMock,
    deleteEntityProperty: deleteEntityPropertyMock,
  },
}));

vi.mock('./graphql/entity', () => ({
  refetchGraphqlInitiativeProperties: async (initiativeId: string) => {
    await initiativePropertyQueryMock(
      EntityPropertiesDocument,
      { input: buildGraphqlEntitySoupInput('INITIATIVE', initiativeId)! },
      { requestPolicy: 'network-only' }
    ).toPromise();
  },
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
  bumpSoupEntityTouchedAt: bumpSoupEntityTouchedAtMock,
  optimisticUpdateSoupEntity: optimisticUpdateSoupEntityMock.mockImplementation(
    () => ({ rollback: rollbackMock })
  ),
}));

import {
  useAddEntityPropertyMutation,
  useBulkSaveEntityPropertiesMutation,
  useBulkUpdateEntityPropertyOptionsMutation,
  useDeleteEntityPropertyMutation,
  useEntityPropertiesQuery,
} from './entity';

let testQueryClient: QueryClient;
let mutation: ReturnType<typeof useBulkSaveEntityPropertiesMutation>;
let addMutation: ReturnType<typeof useAddEntityPropertyMutation>;
let deleteMutation: ReturnType<typeof useDeleteEntityPropertyMutation>;
let bulkOptionsMutation: ReturnType<
  typeof useBulkUpdateEntityPropertyOptionsMutation
>;
let entityQuery: ReturnType<typeof useEntityPropertiesQuery>;
let dispose: (() => void) | undefined;
let graphqlExecutions: Array<{
  variables: unknown;
  context: unknown;
  next: (result: object) => void;
  ended: boolean;
}>;

const property = {
  propertyId: 'assignment-1',
  propertyDefinitionId: 'status-def',
  displayName: 'Status',
  valueType: 'STRING',
  isMultiSelect: false,
  isSystemProperty: true,
  owner: { scope: 'system' },
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
    graphqlExecutions = [];
    graphqlQueryMock.mockImplementation(
      (request: { variables: unknown }, context: unknown) => {
        const subject = makeSubject<unknown>();
        const execution = {
          variables: request.variables,
          context,
          next: (result: object) =>
            subject.next({ ...result, operation: { context } }),
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
    deleteEntityPropertyMock.mockResolvedValue(ok(undefined));
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

  it('submits GraphQL optimism while offline and waits for durable settlement', async () => {
    onlineManager.setOnline(false);
    let commit!: (disposition: { kind: 'committed' }) => void;
    graphqlEntityPropertyMutationMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          commit = resolve;
        })
    );

    const pending = mutation.mutateAsync(variables);
    await vi.waitFor(() =>
      expect(graphqlEntityPropertyMutationMock).toHaveBeenCalledOnce()
    );
    expect(mutation.isPending).toBe(true);
    onlineManager.setOnline(true);
    commit({ kind: 'committed' });
    await expect(pending).resolves.toBeUndefined();

    expect(graphqlEntityPropertyMutationMock).toHaveBeenCalledOnce();
    expect(graphqlEntityPropertyMutationMock).toHaveBeenCalledWith({
      kind: 'save',
      ...variables.properties[0],
    });
    expect(optimisticUpdateSoupEntityMock).not.toHaveBeenCalled();
  });

  it('keeps GraphQL saves pending until settlement without snapshot rollback', async () => {
    let commit!: (disposition: { kind: 'committed' }) => void;
    graphqlEntityPropertyMutationMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          commit = resolve;
        })
    );

    const pending = mutation.mutateAsync(variables);
    await vi.waitFor(() =>
      expect(graphqlEntityPropertyMutationMock).toHaveBeenCalledOnce()
    );
    expect(mutation.isPending).toBe(true);
    expect(invalidateSoupEntityMock).not.toHaveBeenCalled();
    expect(toastFailureMock).not.toHaveBeenCalled();
    commit({ kind: 'committed' });
    await expect(pending).resolves.toBeUndefined();

    expect(optimisticUpdateSoupEntityMock).not.toHaveBeenCalled();
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('detects blocked completion by code even when the message changes', async () => {
    const reportError = vi
      .spyOn(Telemetry, 'error')
      .mockImplementation(() => {});
    onTestFinished(() => reportError.mockRestore());
    readFirstOpenBlockerMock.mockResolvedValueOnce('visible-blocker');
    const error = new CombinedError({
      graphQLErrors: [
        {
          message: 'wrapped completion rejection',
          extensions: { code: 'TASK_BLOCKED', taskId: 'rejected-task' },
        },
      ],
    });
    graphqlEntityPropertyMutationMock.mockResolvedValue({
      kind: 'permanently-failed',
      error,
    });

    await expect(mutation.mutateAsync(variables)).rejects.toBe(error);

    expect(readFirstOpenBlockerMock).toHaveBeenCalledWith({}, 'rejected-task');
    expect(toastFailureMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ actions: expect.any(Array) })
    );
    const action = toastFailureMock.mock.lastCall?.[1]?.actions?.[0];
    expect(action).toBeDefined();
    action?.onClick();
    expect(openWithSplitMock).toHaveBeenCalledExactlyOnceWith(
      { type: 'md', id: 'visible-blocker' },
      { activate: true }
    );
    expect(reportError).not.toHaveBeenCalled();
  });

  it('does not treat matching message text as a blocked completion code', async () => {
    const error = new CombinedError({ graphQLErrors: ['Task is blocked'] });
    graphqlEntityPropertyMutationMock.mockResolvedValue({
      kind: 'permanently-failed',
      error,
    });

    await expect(mutation.mutateAsync(variables)).rejects.toBe(error);

    expect(readFirstOpenBlockerMock).not.toHaveBeenCalled();
    expect(toastFailureMock).toHaveBeenCalledWith('Failed to save properties');
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

  // A saved property is the viewer's own touch: Recent moves the item now.
  it('stamps the viewer’s touch on a saved property, and not on a failed one', async () => {
    await mutation.mutateAsync(variables);
    expect(bumpSoupEntityTouchedAtMock).toHaveBeenCalledExactlyOnceWith(
      'task-1'
    );

    bumpSoupEntityTouchedAtMock.mockClear();
    graphqlEntityPropertyMutationMock.mockResolvedValue({
      kind: 'permanently-failed',
      error: new Error('invalid property'),
    });
    await expect(mutation.mutateAsync(variables)).rejects.toThrow(
      'invalid property'
    );
    expect(bumpSoupEntityTouchedAtMock).not.toHaveBeenCalled();
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
    expect(refreshPropertyQueriesMock).toHaveBeenCalledWith('status-def');
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('refreshes CRM record lists after a custom entity property is saved', async () => {
    await mutation.mutateAsync(variables);
    expect(refreshCrmListsMock).not.toHaveBeenCalled();

    await mutation.mutateAsync({
      properties: [
        {
          entityId: 'task-1',
          entityType: 'TASK' as const,
          property: {
            propertyId: 'assignment-2',
            propertyDefinitionId: 'contact-def',
            displayName: 'Contact',
            valueType: 'ENTITY',
            isMultiSelect: true,
            isSystemProperty: false,
            owner: { scope: 'user', user_id: 'macro|owner@example.com' },
          } as unknown as Property,
          apiValues: {
            valueType: 'ENTITY' as const,
            refs: [{ entity_type: 'CONTACT' as const, entity_id: 'contact-1' }],
          },
        },
      ],
    });
    expect(refreshCrmListsMock).toHaveBeenCalledOnce();
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

  it('removes a native project property through GraphQL', async () => {
    await deleteMutation.mutateAsync({
      entityPropertyId: 'assignment-1',
      entityType: 'INITIATIVE',
      entityId: 'initiative-1',
    });
    expect(deleteEntityPropertyMock).not.toHaveBeenCalled();
    expect(initiativePropertyDeleteMock).toHaveBeenCalledWith(
      DeleteEntityPropertyDocument,
      {
        entityPropertyId: 'assignment-1',
        entityType: 'INITIATIVE',
        entityId: 'initiative-1',
      }
    );
    expect(initiativePropertyQueryMock).toHaveBeenCalledWith(
      EntityPropertiesDocument,
      { input: buildGraphqlEntitySoupInput('INITIATIVE', 'initiative-1')! },
      { requestPolicy: 'network-only' }
    );
    expect(refreshPropertyQueriesMock).toHaveBeenCalledOnce();
  });

  it('invalidates REST projections after delete writes', async () => {
    await deleteMutation.mutateAsync({
      entityPropertyId: 'assignment-1',
      entityType: 'TASK',
      entityId: 'task-1',
    });

    expect(testQueryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateSoupEntityMock).toHaveBeenCalledWith('task-1');
    expect(refreshPropertyQueriesMock).toHaveBeenCalledTimes(1);
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

  it('invalidates REST after a failed REST-backed delete', async () => {
    deleteEntityPropertyMock.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'delete failed' }])
    );
    await expect(
      deleteMutation.mutateAsync({
        entityPropertyId: 'assignment-1',
        entityType: 'USER',
        entityId: 'user-1',
      })
    ).rejects.toThrow('delete failed');

    expect(initiativePropertyDeleteMock).not.toHaveBeenCalled();
    expect(testQueryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  const optionSelection = {
    entityId: 'task-1',
    entityType: 'TASK' as const,
    properties: [
      { property, currentOptionIds: ['todo'], nextOptionIds: ['doing'] },
    ],
  };

  it('refreshes only unmaintained property queries after a GraphQL option selection', async () => {
    updateGraphqlEntityPropertyOptionsMock.mockResolvedValue([
      { propertyDefinitionId: 'status-def', optionIds: ['doing'] },
    ]);

    await expect(
      bulkOptionsMutation.mutateAsync(optionSelection)
    ).resolves.toEqual({
      selections: [
        { propertyDefinitionId: 'status-def', optionIds: ['doing'] },
      ],
    });

    expect(updateGraphqlEntityPropertyOptionsMock).toHaveBeenCalledWith(
      optionSelection
    );
    expect(refreshPropertyQueriesMock).toHaveBeenCalledWith('status-def', {
      includeOptionFilters: true,
      unmaintainedOnly: true,
    });
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('rolls back and reports a failed GraphQL option selection', async () => {
    updateGraphqlEntityPropertyOptionsMock.mockRejectedValue(
      new Error('options failed')
    );

    await expect(
      bulkOptionsMutation.mutateAsync(optionSelection)
    ).rejects.toThrow('options failed');

    expect(rollbackMock).toHaveBeenCalledOnce();
    expect(refreshPropertyQueriesMock).not.toHaveBeenCalled();
    expect(testQueryClient.invalidateQueries).toHaveBeenCalled();
    expect(toastFailureMock).toHaveBeenCalledOnce();
  });
});
