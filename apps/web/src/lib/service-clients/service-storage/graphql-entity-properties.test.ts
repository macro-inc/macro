import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const mapGraphqlPropertiesMock = vi.hoisted(() => vi.fn());

vi.mock('./graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: queryMock }),
  mapGraphqlProperties: mapGraphqlPropertiesMock,
}));

import type { EntityType } from '../service-properties/generated/schemas/entityType';
import type { SoupProperty } from './generated/schemas/soupProperty';
import { EntityPropertiesDocument } from './graphql/generated/graphql';
import {
  buildEntityPropertiesSoupInput,
  getGraphqlEntityProperties,
} from './graphql-entity-properties';

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
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
  const input = buildEntityPropertiesSoupInput(entityType, 'entity-1');
  if (!input || !('initial' in input) || !input.initial) {
    throw new Error(`Expected an initial Soup input for ${entityType}`);
  }
  return input.initial;
}

describe('buildEntityPropertiesSoupInput', () => {
  it.each([
    ['DOCUMENT', 'documentFilter', { literal: { id: 'entity-1' } }],
    ['TASK', 'documentFilter', { literal: { id: 'entity-1' } }],
    ['PROJECT', 'projectFilter', { literal: { projectIdSelf: 'entity-1' } }],
    ['CHAT', 'chatFilter', { literal: { chatId: 'entity-1' } }],
    ['THREAD', 'emailFilter', { tree: { literal: { threadId: 'entity-1' } } }],
    ['CHANNEL', 'channelFilter', { literal: { channelId: 'entity-1' } }],
    ['CALL_RECORD', 'callFilter', { literal: { callId: 'entity-1' } }],
    ['COMPANY', 'crmCompanyFilter', { literal: { id: 'entity-1' } }],
  ] as const)('targets one %s and excludes the other Soup branches', (entityType, filterKey, expectedFilter) => {
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
  });

  it('returns undefined for USER because users are not represented in Soup', () => {
    expect(buildEntityPropertiesSoupInput('USER', 'user-1')).toBeUndefined();
  });
});

describe('getGraphqlEntityProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries from the network and maps only the requested entity properties', async () => {
    const property = { id: 'property-1' };
    const mapped = [{ id: 'property-1' }] as SoupProperty[];
    const toPromise = vi.fn().mockResolvedValue({
      data: {
        user: {
          soup: {
            items: [
              { id: 'other-entity', properties: [] },
              { id: 'entity-1', properties: [property] },
            ],
          },
        },
      },
    });
    queryMock.mockReturnValue({ toPromise });
    mapGraphqlPropertiesMock.mockReturnValue(mapped);

    await expect(
      getGraphqlEntityProperties('DOCUMENT', 'entity-1')
    ).resolves.toBe(mapped);

    expect(queryMock).toHaveBeenCalledWith(
      EntityPropertiesDocument,
      { input: buildEntityPropertiesSoupInput('DOCUMENT', 'entity-1') },
      { requestPolicy: 'network-only' }
    );
    expect(mapGraphqlPropertiesMock).toHaveBeenCalledWith([property]);
  });

  it('does not issue a GraphQL request for USER properties', async () => {
    await expect(
      getGraphqlEntityProperties('USER', 'user-1')
    ).resolves.toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('throws GraphQL transport and application errors', async () => {
    const error = new Error('query failed');
    queryMock.mockReturnValue({
      toPromise: vi.fn().mockResolvedValue({ error }),
    });

    await expect(
      getGraphqlEntityProperties('PROJECT', 'entity-1')
    ).rejects.toBe(error);
  });
});
