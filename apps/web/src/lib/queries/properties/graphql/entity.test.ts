import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import {
  type Client,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filter, makeSubject, mergeMap, pipe } from 'wonka';

const graphqlClientState = vi.hoisted(() => ({
  current: undefined as Client | undefined,
}));
const mapGraphqlPropertiesMock = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => {
    if (!graphqlClientState.current) throw new Error('GraphQL client not set');
    return graphqlClientState.current;
  },
  mapGraphqlProperties: mapGraphqlPropertiesMock,
}));

import {
  buildEntityPropertiesInput,
  createGraphqlEntityPropertiesQuery,
  mapGraphqlEntityProperties,
} from './entity';

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

type ControlledRequest = {
  operation: Operation;
  next: (result?: Pick<OperationResult, 'data' | 'error'>) => void;
};

function makeControlledClient() {
  const requests: ControlledRequest[] = [];
  const exchange: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) => {
        const subject = makeSubject<OperationResult>();
        requests.push({
          operation,
          next: (result = {}) =>
            subject.next({
              operation,
              data: result.data,
              error: result.error,
              stale: false,
              hasNext: false,
            }),
        });
        return subject.source;
      })
    );
  const client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [exchange],
  });
  graphqlClientState.current = client;
  return { client, requests };
}

const EMPTY_DATA = {
  user: { id: 'user-1', soup: { items: [] } },
};
const NIL_FILTERS = {
  documentFilter: { literal: { id: NIL_ENTITY_ID } },
  projectFilter: { literal: { projectIdSelf: NIL_ENTITY_ID } },
  chatFilter: { literal: { chatId: NIL_ENTITY_ID } },
  emailFilter: { tree: { literal: { threadId: NIL_ENTITY_ID } } },
  channelFilter: { literal: { channelId: NIL_ENTITY_ID } },
  channelThreadFilter: { literal: { threadId: NIL_ENTITY_ID } },
  callFilter: { literal: { callId: NIL_ENTITY_ID } },
  crmCompanyFilter: { literal: { id: NIL_ENTITY_ID } },
  foreignEntityFilter: { literal: { id: NIL_ENTITY_ID } },
};

function initialInput(entityType: EntityType) {
  const input = buildEntityPropertiesInput(entityType, 'entity-1');
  if (!input || !('initial' in input) || !input.initial) {
    throw new Error(`Expected an initial Soup input for ${entityType}`);
  }
  return input.initial;
}

describe('buildEntityPropertiesInput', () => {
  it.each([
    ['DOCUMENT', 'documentFilter', { literal: { id: 'entity-1' } }],
    ['TASK', 'documentFilter', { literal: { id: 'entity-1' } }],
    ['PROJECT', 'projectFilter', { literal: { projectIdSelf: 'entity-1' } }],
    ['CHAT', 'chatFilter', { literal: { chatId: 'entity-1' } }],
    ['THREAD', 'emailFilter', { tree: { literal: { threadId: 'entity-1' } } }],
    ['CHANNEL', 'channelFilter', { literal: { channelId: 'entity-1' } }],
    ['CALL_RECORD', 'callFilter', { literal: { callId: 'entity-1' } }],
    ['COMPANY', 'crmCompanyFilter', { literal: { id: 'entity-1' } }],
  ] as const)(
    'targets one %s and excludes the other Soup branches',
    (entityType, filterKey, expectedFilter) => {
      const input = initialInput(entityType);

      expect(input).toMatchObject({
        limit: 1,
        expand: true,
        sortMethod: 'UPDATED_AT',
        emailView: 'ALL',
      });
      expect(input.filters).toEqual({
        ...NIL_FILTERS,
        [filterKey]: expectedFilter,
      });
    }
  );

  it('returns undefined for USER because users are not represented in Soup', () => {
    expect(buildEntityPropertiesInput('USER', 'user-1')).toBeUndefined();
  });
});

describe('mapGraphqlEntityProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps only the requested entity properties', () => {
    const property = { id: 'property-1' };
    const mapped = [{ id: 'property-1' }] as SoupProperty[];
    mapGraphqlPropertiesMock.mockReturnValue(mapped);

    expect(
      mapGraphqlEntityProperties(
        {
          user: {
            id: 'user-1',
            soup: {
              items: [
                {
                  __typename: 'GraphqlSoupDocument',
                  id: 'other-entity',
                  properties: [],
                },
                {
                  __typename: 'GraphqlSoupDocument',
                  id: 'entity-1',
                  properties: [property],
                },
              ],
            },
          },
        } as never,
        'entity-1'
      )
    ).toBe(mapped);
    expect(mapGraphqlPropertiesMock).toHaveBeenCalledWith([property]);
  });

  it('retains the not-yet-loaded distinction', () => {
    expect(mapGraphqlEntityProperties(undefined, 'entity-1')).toBeUndefined();
    expect(mapGraphqlPropertiesMock).not.toHaveBeenCalled();
  });
});

describe('createGraphqlEntityPropertiesQuery', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    graphqlClientState.current = undefined;
    mapGraphqlPropertiesMock.mockReturnValue([]);
  });

  afterEach(() => dispose?.());

  it('owns the live operation and refetches it network-only', async () => {
    const { requests } = makeControlledClient();
    const [entityType] = createSignal<EntityType>('DOCUMENT');
    const [entityId] = createSignal('entity-1');
    const [enabled] = createSignal(true);
    let query!: ReturnType<typeof createGraphqlEntityPropertiesQuery>;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      query = createGraphqlEntityPropertiesQuery({
        entityType,
        entityId,
        enabled,
      });
    });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.operation.context.requestPolicy).toBe(
      'cache-and-network'
    );
    requests[0]?.next({ data: EMPTY_DATA });
    await vi.waitFor(() => expect(query.result.data).toEqual([]));

    const refetch = query.refetch();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.operation.context.requestPolicy).toBe('network-only');
    requests[1]?.next({ data: EMPTY_DATA });
    await refetch;
  });

  it('does not start an operation for unsupported entity types', () => {
    const { requests } = makeControlledClient();
    const [entityType] = createSignal<EntityType>('USER');
    const [entityId] = createSignal('user-1');
    const [enabled] = createSignal(true);

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const query = createGraphqlEntityPropertiesQuery({
        entityType,
        entityId,
        enabled,
      });
      expect(query.isEnabled()).toBe(false);
    });

    expect(requests).toHaveLength(0);
  });
});
