import { externalWriteVersion } from '@graphql-cache/exchange/external-writes';
import type { CacheHost } from '@graphql-cache/host/types';
import { beforeEach, expect, it, vi } from 'vitest';
import { prepareCrmContactEdit } from './crm-contact-edit';

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
const contact = {
  id: 'contact-1',
  companyId: null,
  email: null,
  name: 'Example person',
  hidden: true,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-02',
  firstInteraction: '2026-10-01',
  lastInteraction: '2026-10-01',
};

it('publishes explicit clears through the normalized document and fences older reads', async () => {
  const host = mocks.host as unknown as CacheHost;
  const before = externalWriteVersion(host);
  await prepareCrmContactEdit().commit(contact, null);
  expect(externalWriteVersion(host)).toBeGreaterThan(before);
  expect(mocks.host.writeQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      operationName: 'CrmContactCacheWrite',
      data: {
        soupUpdates: [
          {
            __typename: 'SoupUpdated',
            item: {
              __typename: 'GraphqlSoupCrmContact',
              id: contact.id,
              parentCompanyId: null,
              parentCompanyName: null,
              emailAddress: null,

              updatedAt: contact.updatedAt,
            },
          },
        ],
      },
    })
  );
});
it('rejects writes after the session changed', async () => {
  const writer = prepareCrmContactEdit();
  mocks.client = {};
  expect(writer.isCurrent()).toBe(false);
  await writer.commit(contact, null);
  expect(mocks.host.writeQuery).not.toHaveBeenCalled();
});
it('repairs only the affected contact on cache failure without reporting a committed save as failed', async () => {
  mocks.host.writeQuery.mockRejectedValueOnce(new Error('worker unavailable'));
  await expect(
    prepareCrmContactEdit().commit(contact, null)
  ).resolves.toBeUndefined();
  expect(mocks.host.deleteRecords).toHaveBeenCalledWith([
    'GraphqlSoupCrmContact:contact-1',
  ]);
});

it('fences and invalidates an uncertain contact without crossing a replaced session', async () => {
  const writer = prepareCrmContactEdit();
  const host = mocks.host as unknown as CacheHost;
  const before = externalWriteVersion(host);
  await writer.invalidate(contact.id);
  expect(externalWriteVersion(host)).toBeGreaterThan(before);
  expect(mocks.host.deleteRecords).toHaveBeenCalledExactlyOnceWith([
    'GraphqlSoupCrmContact:contact-1',
  ]);
  mocks.client = {};
  await writer.invalidate('contact-2');
  expect(mocks.host.deleteRecords).toHaveBeenCalledTimes(1);
});
