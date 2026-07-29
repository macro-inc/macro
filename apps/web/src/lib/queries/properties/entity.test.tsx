import type { Property } from '@property/types';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setEntityPropertyMock = vi.hoisted(() => vi.fn());
const getGraphqlEntityPropertiesMock = vi.hoisted(() => vi.fn());
const getRestEntityPropertiesMock = vi.hoisted(() => vi.fn());
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

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: toastFailureMock },
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_SOUP: graphqlSoupEnabledMock,
}));

vi.mock('@entity/extractors-property/property-helpers', () => ({
  soupPropertyToProperty: soupPropertyToPropertyMock,
}));

vi.mock('@property/api/converters', () => ({
  entityPropertyFromApi: entityPropertyFromApiMock,
  propertyValueToApi: vi.fn(() => ({ type: 'string', value: 'doing' })),
}));

vi.mock('@property/utils', () => ({
  isInstantiatedProperty: vi.fn(() => true),
}));

vi.mock('../../service-clients/service-properties/client', () => ({
  propertiesServiceClient: {
    getEntityProperties: getRestEntityPropertiesMock,
  },
}));

vi.mock(
  '../../service-clients/service-storage/graphql-entity-properties',
  () => ({
    getGraphqlEntityProperties: getGraphqlEntityPropertiesMock,
  })
);

vi.mock('../../service-clients/service-storage/graphql-properties', () => ({
  setEntityProperty: setEntityPropertyMock,
}));

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('../../service-clients/service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(() => ({})),
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
  buildOptimisticSetEntityProperty: vi.fn(() => ({ id: 'assignment-1' })),
}));

import {
  useAddEntityPropertyMutation,
  useBulkSaveEntityPropertiesMutation,
  useEntityPropertiesQuery,
} from './entity';

let testQueryClient: QueryClient;
let mutation: ReturnType<typeof useBulkSaveEntityPropertiesMutation>;
let addMutation: ReturnType<typeof useAddEntityPropertyMutation>;
let entityQuery: ReturnType<typeof useEntityPropertiesQuery>;
let dispose: (() => void) | undefined;

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
  });
}

function renderEntityQuery(
  includeMetadata: boolean,
  entityType: 'DOCUMENT' | 'USER' = 'DOCUMENT',
  entityId = 'document-1'
): void {
  renderWithQueryClient(() => {
    entityQuery = useEntityPropertiesQuery(
      () => entityType,
      () => entityId,
      includeMetadata
    );
  });
}

describe('useEntityPropertiesQuery transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphqlSoupEnabledMock.mockReturnValue(true);
    testQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
  });

  it('uses GraphQL for non-metadata entity properties when enabled', async () => {
    const soupProperty = { id: 'assignment-1' };
    getGraphqlEntityPropertiesMock.mockResolvedValue([soupProperty]);
    soupPropertyToPropertyMock.mockReturnValue(property);

    renderEntityQuery(false);

    await vi.waitFor(() => expect(entityQuery.data).toEqual([property]));
    expect(getGraphqlEntityPropertiesMock).toHaveBeenCalledWith(
      'DOCUMENT',
      'document-1'
    );
    expect(soupPropertyToPropertyMock).toHaveBeenCalledWith(soupProperty);
    expect(getRestEntityPropertiesMock).not.toHaveBeenCalled();
  });

  it('keeps metadata requests on REST', async () => {
    const apiProperty = { property: { id: 'assignment-1' } };
    getRestEntityPropertiesMock.mockResolvedValue(
      ok({ properties: [apiProperty] })
    );
    entityPropertyFromApiMock.mockReturnValue(property);

    renderEntityQuery(true);

    await vi.waitFor(() => expect(entityQuery.data).toEqual([property]));
    expect(getGraphqlEntityPropertiesMock).not.toHaveBeenCalled();
    expect(getRestEntityPropertiesMock).toHaveBeenCalledWith({
      entity_type: 'DOCUMENT',
      entity_id: 'document-1',
      query: { include_metadata: true },
    });
  });

  it('uses REST when the GraphQL feature is disabled', async () => {
    graphqlSoupEnabledMock.mockReturnValue(false);
    getRestEntityPropertiesMock.mockResolvedValue(ok({ properties: [] }));

    renderEntityQuery(false);

    await vi.waitFor(() => expect(entityQuery.data).toEqual([]));
    expect(getGraphqlEntityPropertiesMock).not.toHaveBeenCalled();
    expect(getRestEntityPropertiesMock).toHaveBeenCalledWith({
      entity_type: 'DOCUMENT',
      entity_id: 'document-1',
      query: { include_metadata: false },
    });
  });

  it('falls back to REST for USER properties, which Soup cannot query', async () => {
    getGraphqlEntityPropertiesMock.mockResolvedValue(undefined);
    getRestEntityPropertiesMock.mockResolvedValue(ok({ properties: [] }));

    renderEntityQuery(false, 'USER', 'user-1');

    await vi.waitFor(() => expect(entityQuery.data).toEqual([]));
    expect(getGraphqlEntityPropertiesMock).toHaveBeenCalledWith(
      'USER',
      'user-1'
    );
    expect(getRestEntityPropertiesMock).toHaveBeenCalledWith({
      entity_type: 'USER',
      entity_id: 'user-1',
      query: { include_metadata: false },
    });
  });
});

describe('useBulkSaveEntityPropertiesMutation dispositions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    optimisticUpdateSoupEntityMock.mockReturnValue({ rollback: rollbackMock });
    graphqlSoupEnabledMock.mockReturnValue(true);
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
    dispose?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
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
    expect(toastFailureMock).toHaveBeenCalledWith('Failed to save properties');
  });

  it('invalidates a queued TanStack projection after commit', async () => {
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
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('does not invalidate TanStack property queries for GraphQL attachments', async () => {
    setEntityPropertyMock.mockResolvedValue({ kind: 'committed' });

    await addMutation.mutateAsync({
      entityId: 'task-1',
      entityType: 'TASK',
      propertyDefinitionId: 'status-def',
    });

    expect(testQueryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(toastFailureMock).not.toHaveBeenCalled();
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
