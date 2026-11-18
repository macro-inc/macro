import { externalWriteVersion } from '@graphql-cache/exchange/external-writes';
import type { CacheHost } from '@graphql-cache/host/types';
import { beforeEach, expect, it, vi } from 'vitest';
import { prepareCrmVisibilityWrite } from './crm-visibility';

const mocks = vi.hoisted(() => ({
  client: {},
  host: { writeQuery: vi.fn(), deleteRecords: vi.fn() },
  error: vi.fn(),
}));
vi.mock('./graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  getGraphqlSoupCacheHost: () => mocks.host,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: mocks.error },
}));
beforeEach(() => {
  mocks.client = {};
  mocks.host = {
    writeQuery: vi.fn(async () => undefined),
    deleteRecords: vi.fn(async () => undefined),
  };
  mocks.error.mockClear();
});

it('writes confirmed company and contact flags with the generated normalized subscription document', async () => {
  const writer = prepareCrmVisibilityWrite();
  const host = mocks.host as unknown as CacheHost;
  const before = externalWriteVersion(host);
  await writer.commit({
    companyId: 'company-1',
    contactIds: ['contact-1', 'contact-2'],
    hidden: true,
  });
  expect(externalWriteVersion(host)).toBeGreaterThan(before);
  expect(mocks.host.writeQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      operationName: 'CrmVisibilityCacheWrite',
      query: expect.stringContaining('... on GraphqlSoupCrmContact'),
      data: {
        soupUpdates: [
          {
            __typename: 'SoupUpdated',
            item: {
              __typename: 'GraphqlSoupCrmContact',
              id: 'contact-1',
              hidden: true,
            },
          },
          {
            __typename: 'SoupUpdated',
            item: {
              __typename: 'GraphqlSoupCrmContact',
              id: 'contact-2',
              hidden: true,
            },
          },
          {
            __typename: 'SoupUpdated',
            item: {
              __typename: 'GraphqlSoupCrmCompany',
              id: 'company-1',
              hidden: true,
            },
          },
        ],
      },
    })
  );
  await writer.commit({ contactIds: ['contact-1'], hidden: false });
  expect(mocks.host.writeQuery.mock.calls[1][0].data.soupUpdates).toEqual([
    {
      __typename: 'SoupUpdated',
      item: {
        __typename: 'GraphqlSoupCrmContact',
        id: 'contact-1',
        hidden: false,
      },
    },
  ]);
});

it('does not write a previous session response into the next session', async () => {
  const writer = prepareCrmVisibilityWrite();
  mocks.client = {};
  expect(writer.isCurrent()).toBe(false);
  await writer.commit({ contactIds: ['contact-1'], hidden: true });
  expect(mocks.host.writeQuery).not.toHaveBeenCalled();
});

it('removes only affected stale records if a confirmed cache write fails, without rejecting the saved action', async () => {
  mocks.host.writeQuery.mockRejectedValueOnce(new Error('worker unavailable'));
  await expect(
    prepareCrmVisibilityWrite().commit({
      companyId: 'company-1',
      contactIds: ['contact-1'],
      hidden: true,
    })
  ).resolves.toBeUndefined();
  expect(mocks.host.deleteRecords).toHaveBeenCalledWith([
    'GraphqlSoupCrmContact:contact-1',
    'GraphqlSoupCrmCompany:company-1',
  ]);
  expect(mocks.error).toHaveBeenCalledOnce();
});
