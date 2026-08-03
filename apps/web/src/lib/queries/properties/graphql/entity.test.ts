import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { EntityPropertiesDocument } from '@service-storage/graphql/generated/graphql';
import {
  type Client,
  CombinedError,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  fetchGraphqlEntityProperties,
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

describe('fetchGraphqlEntityProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphqlClientState.current = undefined;
    mapGraphqlPropertiesMock.mockReturnValue([]);
  });

  it('dispatches exactly one network-only request without an active query', async () => {
    const { requests } = makeControlledClient();
    const fetch = fetchGraphqlEntityProperties('DOCUMENT', 'entity-1');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(requests[0]?.operation.context.requestPolicy).toBe('network-only');
    requests[0]?.next({ data: EMPTY_DATA });

    await expect(fetch).resolves.toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('waits for an identical active query then dispatches network-only', async () => {
    const { client, requests } = makeControlledClient();
    const input = buildEntityPropertiesInput('DOCUMENT', 'entity-1');
    if (!input) throw new Error('expected GraphQL input');
    const active = client
      .query(
        EntityPropertiesDocument,
        { input },
        { requestPolicy: 'cache-and-network' }
      )
      .subscribe(() => undefined);
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    const fetch = fetchGraphqlEntityProperties('DOCUMENT', 'entity-1');
    expect(requests).toHaveLength(1);
    requests[0]?.next({ data: EMPTY_DATA });

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.operation.context.requestPolicy).toBe('network-only');
    requests[1]?.next({ data: EMPTY_DATA });
    await expect(fetch).resolves.toEqual([]);
    active.unsubscribe();
  });

  it('allows urql to coalesce simultaneous same-entity fetches', async () => {
    const { requests } = makeControlledClient();
    const first = fetchGraphqlEntityProperties('DOCUMENT', 'entity-1');
    const second = fetchGraphqlEntityProperties('DOCUMENT', 'entity-1');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    requests[0]?.next({ data: EMPTY_DATA });
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    expect(requests).toHaveLength(1);
  });

  it('allows urql to coalesce simultaneous TASK and DOCUMENT aliases', async () => {
    const { requests } = makeControlledClient();
    const first = fetchGraphqlEntityProperties('DOCUMENT', 'entity-1');
    const second = fetchGraphqlEntityProperties('TASK', 'entity-1');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    requests[0]?.next({ data: EMPTY_DATA });
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    expect(requests).toHaveLength(1);
  });

  it('does not issue a GraphQL request for USER properties', async () => {
    const { requests } = makeControlledClient();
    await expect(
      fetchGraphqlEntityProperties('USER', 'user-1')
    ).resolves.toBeUndefined();
    expect(requests).toHaveLength(0);
  });

  it('retries a network error once, then surfaces it', async () => {
    const { requests } = makeControlledClient();
    const fetch = fetchGraphqlEntityProperties('PROJECT', 'entity-1');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0]?.next({
      error: new CombinedError({ networkError: new Error('offline') }),
    });

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const finalError = new CombinedError({
      networkError: new Error('still offline'),
    });
    requests[1]?.next({ error: finalError });

    await expect(fetch).rejects.toBe(finalError);
    expect(requests).toHaveLength(2);
  });

  it('throws GraphQL application errors without looping', async () => {
    const { requests } = makeControlledClient();
    const fetch = fetchGraphqlEntityProperties('PROJECT', 'entity-1');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const error = new CombinedError({ graphQLErrors: ['query failed'] });
    requests[0]?.next({ error });

    await expect(fetch).rejects.toBe(error);
    expect(requests).toHaveLength(1);
  });
});
